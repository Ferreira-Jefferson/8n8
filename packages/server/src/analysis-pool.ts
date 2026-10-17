import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type {
  FlowEdge,
  LanguageAnalysis,
  LanguagePlugin,
  LinkRequest,
  Offer,
  SourceFile,
} from "@8n8/model";
import type { AnalysisRunner, SliceHandle } from "@8n8/project";
import type { PackingRunner, PackingSlice, PackRequest } from "./project-build";
import type { PackedAnalysis, PackedFile } from "./project-pack";

/**
 * What the main thread asks of a worker. `slice` names a slice that the worker keeps between
 * requests (its parse trees live there); `run` is a whole group, with nothing kept.
 * With `pack`, an analysis comes back as packed files, not as graphs.
 */
export type AnalysisRequest =
  | { op: "open"; slice: number; pluginId: string; files: SourceFile[] }
  | { op: "contribute"; slice: number }
  | {
      op: "analyze";
      slice: number;
      contributions: unknown[];
      pack?: PackRequest;
    }
  | { op: "dispose"; slice: number }
  | { op: "run"; pluginId: string; files: SourceFile[]; pack?: PackRequest };

/** An analysis comes back as some `files` messages, then one `done`; any other request, as one `result`. */
export type AnalysisReply = { id: number } & (
  | { files: LanguageAnalysis["files"] | PackedFile[] }
  | { done: { imports: FlowEdge[]; offers: Offer[]; requests: LinkRequest[] } }
  | { result: unknown }
  | { error: string }
);

export interface AnalysisPool extends AnalysisRunner, PackingRunner {
  close(): Promise<void>;
}

export interface PoolOptions {
  /** The bundled worker (analysis-worker.mjs). */
  worker: string | URL;
  /** For a worker that runs from source, e.g. `["--import", "tsx"]`. */
  execArgv?: string[];
  size?: number;
  /** Workers go away after this long without a request, and give their memory back. */
  idleMs?: number;
}

/**
 * One worker less than the cores, so the builder keeps a core; at most 3. Each worker holds its own
 * parser and trees, about 500 MB at the peak: on a project of 3 000 files, 8 workers took 8 s and
 * 3 GB, 4 workers 13 s and 2.2 GB, 3 workers 15 s and 1.95 GB.
 */
export function defaultPoolSize(): number {
  return Math.max(1, Math.min(availableParallelism() - 1, 3));
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  /** The `files` messages of an analysis, until its `done`. */
  files: (LanguageAnalysis["files"][number] | PackedFile)[];
}

/** A worker and the requests it has not answered yet. */
interface Slot {
  worker: Worker;
  pending: Map<number, Pending>;
}

/**
 * Workers start on demand and are reused between calls. A worker with open requests keeps the
 * process alive; an idle one does not, and goes away after `idleMs`.
 */
export function createAnalysisPool(options: PoolOptions): AnalysisPool {
  const size = options.size ?? defaultPoolSize();
  const idleMs = options.idleMs ?? 10_000;
  const slots: (Slot | undefined)[] = Array.from({ length: size });
  let nextId = 0;
  let nextSlice = 0;
  let nextWorker = 0;
  let idleTimer: NodeJS.Timeout | undefined;

  function stop(index: number, error: Error): void {
    const slot = slots[index];
    if (!slot) return;
    slots[index] = undefined;
    void slot.worker.terminate();
    for (const pending of slot.pending.values()) pending.reject(error);
    slot.pending.clear();
  }

  function close(): Promise<void> {
    clearTimeout(idleTimer);
    for (let i = 0; i < slots.length; i++) {
      stop(i, new Error("analysis pool closed"));
    }
    return Promise.resolve();
  }

  /** With no request open anywhere, a timer ends the workers. */
  function rest(): void {
    clearTimeout(idleTimer);
    if (!slots.some((slot) => slot !== undefined)) return;
    if (slots.some((slot) => slot && slot.pending.size > 0)) return;
    idleTimer = setTimeout(() => void close(), idleMs);
    idleTimer.unref();
  }

  function start(index: number): Slot {
    const worker = new Worker(options.worker, { execArgv: options.execArgv });
    worker.unref();
    const slot: Slot = { worker, pending: new Map() };
    worker.on("message", (reply: AnalysisReply) => {
      const pending = slot.pending.get(reply.id);
      if (!pending) return;
      if ("files" in reply) {
        pending.files.push(...reply.files);
        return;
      }
      slot.pending.delete(reply.id);
      if (slot.pending.size === 0) worker.unref();
      if ("error" in reply) pending.reject(new Error(reply.error));
      else if ("done" in reply)
        pending.resolve({ files: pending.files, ...reply.done });
      else pending.resolve(reply.result);
      rest();
    });
    const lost = (error: Error) => {
      if (slots[index] === slot) stop(index, error);
    };
    worker.on("error", lost);
    worker.on("exit", () => lost(new Error("analysis worker stopped")));
    slots[index] = slot;
    return slot;
  }

  function send(index: number, request: AnalysisRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      try {
        const slot = slots[index] ?? start(index);
        const id = nextId++;
        slot.pending.set(id, { resolve, reject, files: [] });
        clearTimeout(idleTimer);
        // A worker with a request open keeps the process alive: the caller is waiting for it.
        slot.worker.ref();
        slot.worker.postMessage({ ...request, id });
      } catch (error) {
        reject(error as Error);
      }
    });
  }

  /** A whole group in one worker. */
  function run(
    plugin: LanguagePlugin,
    files: SourceFile[],
    pack?: PackRequest,
  ) {
    const index = nextWorker++ % size;
    return send(index, {
      op: "run",
      pluginId: plugin.id,
      files,
      ...(pack === undefined ? {} : { pack }),
    });
  }

  /** A slice kept by one worker; its analysis comes as graphs, or, with `pack`, as packed files. */
  function open(plugin: LanguagePlugin, files: SourceFile[]) {
    const index = nextWorker++ % size;
    const slice = nextSlice++;
    const opened = send(index, {
      op: "open",
      slice,
      pluginId: plugin.id,
      files,
    });
    // The error of opening shows in `contribute`, the first thing asked of a slice.
    opened.catch(() => undefined);
    return {
      async contribute() {
        await opened;
        return send(index, { op: "contribute", slice });
      },
      analyze(contributions: unknown[], pack?: PackRequest) {
        return send(index, {
          op: "analyze",
          slice,
          contributions,
          ...(pack === undefined ? {} : { pack }),
        });
      },
      dispose() {
        // A worker that is gone took its slice along: do not start one just to drop it.
        if (!slots[index]) return;
        send(index, { op: "dispose", slice }).catch(() => undefined);
      },
    };
  }

  return {
    size,
    close,
    analyze: (plugin, files) => run(plugin, files) as Promise<LanguageAnalysis>,
    openSlice(plugin, files): SliceHandle {
      const slice = open(plugin, files);
      return {
        contribute: slice.contribute,
        analyze: (contributions) =>
          slice.analyze(contributions) as Promise<LanguageAnalysis>,
        dispose: slice.dispose,
      };
    },
    runPacked: (plugin, files, pack) =>
      run(plugin, files, pack) as Promise<PackedAnalysis>,
    openPackedSlice(plugin, files): PackingSlice {
      const slice = open(plugin, files);
      return {
        contribute: slice.contribute,
        analyze: (contributions, pack) =>
          slice.analyze(contributions, pack) as Promise<PackedAnalysis>,
        dispose: slice.dispose,
      };
    },
  };
}
