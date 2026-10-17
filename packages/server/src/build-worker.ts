import { parentPort } from "node:worker_threads";
import { openAnalysisCache } from "./analysis-cache";
import { createAnalysisPool } from "./analysis-pool";
import { languagePlugins } from "./plugins";
import { type BuildInput, buildStreamed } from "./project-build";
import type { FileUnit, StoreParts } from "./project-store";

// The builder thread: it runs a whole build (analyze, pack, join) off the thread that serves the requests.
// It runs inside analysis-worker.mjs, started with `workerData.role` "builder"; it starts its own analysis
// workers, which pack the files they analyze, so the graphs of the project never reach this thread.

/** What the main thread gives the builder when it starts it. */
export interface BuilderData {
  role: "builder";
  /** The bundled analysis worker, which the builder starts its own pool from. */
  analysisWorker: string | URL;
  /** For a worker that runs from source, e.g. `["--import", "tsx"]`. */
  execArgv?: string[];
  /** The file of the analysis cache; without it, the builder keeps nothing between builds. */
  cacheFile?: string;
}

export interface BuilderRequest {
  id: number;
  input: BuildInput;
}

/**
 * A build comes back as some `files` messages (packed files), then one `parts` with the
 * rest (its `files` empty), or as the message of what failed. The main thread reads each message in a few milliseconds.
 */
export type BuilderReply =
  | { id: number; files: FileUnit[] }
  | { id: number; parts: StoreParts }
  | { id: number; error: string };

/** Files per message to the main thread. */
const BATCH = 100;

/** Answers the build requests of the main thread, one at a time in the order they come. */
export function serveBuilds(data: BuilderData): void {
  const pool = createAnalysisPool({
    worker: data.analysisWorker,
    ...(data.execArgv === undefined ? {} : { execArgv: data.execArgv }),
  });
  const reply = (message: BuilderReply, transfer: ArrayBuffer[] = []) =>
    parentPort?.postMessage(message, transfer);
  parentPort?.on("message", async ({ id, input }: BuilderRequest) => {
    // Opened for each build and closed after it: the file is free for another process between two builds.
    const cache =
      data.cacheFile === undefined
        ? undefined
        : openAnalysisCache(data.cacheFile);
    try {
      const { files, ...rest } = await buildStreamed(
        input,
        languagePlugins,
        pool,
        {
          onFallback: (error) =>
            console.error(
              "análise: o worker falhou, seguindo em sequência",
              error,
            ),
          // The analysis workers hold the parse trees: they go away before the join.
          analyzed: () => pool.close(),
          ...(cache === undefined ? {} : { cache }),
        },
      );
      for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH);
        reply(
          { id, files: batch },
          batch.map((f) => f.blob.buffer as ArrayBuffer),
        );
      }
      reply({ id, parts: { ...rest, files: [] } });
      // After the answer: the one who asked does not wait for the disk.
      cache?.flush();
    } catch (error) {
      reply({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      cache?.close();
    }
  });
}
