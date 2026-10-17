import { Worker } from "node:worker_threads";
import type { BuilderData, BuilderReply } from "./build-worker";
import type { BuildInput } from "./project-build";
import type { FileUnit, StoreParts } from "./project-store";

export interface ProjectBuilder {
  /** Builds the project in the builder thread; rejects when that thread fails, so the caller can build in its own. */
  build(input: BuildInput): Promise<StoreParts>;
  close(): Promise<void>;
}

export interface BuilderOptions {
  /** The bundled worker (analysis-worker.mjs): it serves the builder role and the analysis role. */
  worker: string | URL;
  /** For a worker that runs from source, e.g. `["--import", "tsx"]`. */
  execArgv?: string[];
  /** The thread goes away after this long without a build, and gives its memory back: a build leaves the heap of a whole graph behind. */
  idleMs?: number;
}

interface Pending {
  resolve: (parts: StoreParts) => void;
  reject: (error: Error) => void;
  /** The packed files that came before the rest. */
  files: FileUnit[];
}

/**
 * One builder thread, started on demand. It builds one project at a time, in the order asked, so two
 * folders never hold two graphs at once. A thread that stops (crash, out of memory) rejects what it owed.
 */
export function createProjectBuilder(options: BuilderOptions): ProjectBuilder {
  const idleMs = options.idleMs ?? 10_000;
  let current: { worker: Worker; pending: Map<number, Pending> } | undefined;
  let nextId = 0;
  let idleTimer: NodeJS.Timeout | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  /** Counts the closes: a build asked before a close never starts after it. */
  let epoch = 0;

  function stop(error: Error): void {
    clearTimeout(idleTimer);
    const slot = current;
    if (!slot) return;
    current = undefined;
    void slot.worker.terminate();
    for (const pending of slot.pending.values()) pending.reject(error);
    slot.pending.clear();
  }

  function start(): NonNullable<typeof current> {
    const data: BuilderData = {
      role: "builder",
      analysisWorker: options.worker,
      ...(options.execArgv === undefined ? {} : { execArgv: options.execArgv }),
    };
    const worker = new Worker(options.worker, {
      workerData: data,
      ...(options.execArgv === undefined ? {} : { execArgv: options.execArgv }),
    });
    worker.unref();
    const slot = { worker, pending: new Map<number, Pending>() };
    worker.on("message", (reply: BuilderReply) => {
      const pending = slot.pending.get(reply.id);
      if (!pending) return;
      if ("files" in reply) {
        pending.files.push(...reply.files);
        return;
      }
      slot.pending.delete(reply.id);
      if (slot.pending.size === 0) {
        worker.unref();
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => stop(new Error("builder closed")), idleMs);
        idleTimer.unref();
      }
      if ("error" in reply) pending.reject(new Error(reply.error));
      else pending.resolve({ ...reply.parts, files: pending.files });
    });
    const lost = (error: Error) => {
      if (current === slot) stop(error);
    };
    worker.on("error", lost);
    worker.on("exit", () => lost(new Error("build worker stopped")));
    current = slot;
    return slot;
  }

  function send(input: BuildInput): Promise<StoreParts> {
    return new Promise((resolve, reject) => {
      try {
        const slot = current ?? start();
        const id = nextId++;
        slot.pending.set(id, { resolve, reject, files: [] });
        clearTimeout(idleTimer);
        // A thread with a build open keeps the process alive: the caller is waiting for it.
        slot.worker.ref();
        slot.worker.postMessage({ id, input });
      } catch (error) {
        reject(error as Error);
      }
    });
  }

  return {
    build(input) {
      const asked = epoch;
      const run = queue.then(() => {
        if (asked !== epoch) throw new Error("builder closed");
        return send(input);
      });
      queue = run.catch(() => undefined);
      return run;
    },
    close() {
      epoch++;
      stop(new Error("builder closed"));
      return Promise.resolve();
    },
  };
}
