import { parentPort } from "node:worker_threads";
import { analyzeProjectParallel } from "@8n8/project";
import { createAnalysisPool } from "./analysis-pool";
import { languagePlugins } from "./plugins";
import { type BuildInput, buildWith } from "./project-build";
import { compactProjectAsync } from "./project-compact";
import type { FileUnit, StoreParts } from "./project-store";

// The builder thread: it runs a whole build (analyze, link, pack) off the thread that serves the requests.
// It runs inside analysis-worker.mjs, started with `workerData.role` "builder"; it starts its own analysis workers.

/** What the main thread gives the builder when it starts it. */
export interface BuilderData {
  role: "builder";
  /** The bundled analysis worker, which the builder starts its own pool from. */
  analysisWorker: string | URL;
  /** For a worker that runs from source, e.g. `["--import", "tsx"]`. */
  execArgv?: string[];
}

export interface BuilderRequest {
  id: number;
  input: BuildInput;
}

/**
 * A build comes back as some `files` messages (packed files, as they are ready), then one `parts` with the
 * rest (its `files` empty), or as the message of what failed. The main thread reads each message in a few milliseconds.
 */
export type BuilderReply =
  | { id: number; files: FileUnit[] }
  | { id: number; parts: StoreParts }
  | { id: number; error: string };

/** Fewer files than this and the analysis workers cost more than they save. */
const MIN_PARALLEL_FILES = 150;

/** The packed files go to the main thread by transfer, not by copy: each blob needs a buffer of its own. */
function transferable(files: FileUnit[]): ArrayBuffer[] {
  return files.map((unit) => {
    // A zlib result can sit in the shared pool of small buffers: copy it out before it moves.
    unit.blob = new Uint8Array(unit.blob);
    return unit.blob.buffer as ArrayBuffer;
  });
}

/** Answers the build requests of the main thread, one at a time in the order they come. */
export function serveBuilds(data: BuilderData): void {
  const pool = createAnalysisPool({
    worker: data.analysisWorker,
    ...(data.execArgv === undefined ? {} : { execArgv: data.execArgv }),
  });
  const reply = (message: BuilderReply, transfer: ArrayBuffer[] = []) =>
    parentPort?.postMessage(message, transfer);
  parentPort?.on("message", async ({ id, input }: BuilderRequest) => {
    try {
      const parts = await buildWith(
        input,
        languagePlugins,
        async (files, plugins) => {
          try {
            return await analyzeProjectParallel(files, plugins, {
              runner: pool,
              minFiles: MIN_PARALLEL_FILES,
              onFallback: (error) =>
                console.error(
                  "análise: o worker falhou, seguindo em sequência",
                  error,
                ),
            });
          } finally {
            // The analysis workers hold the parse trees: they go away before the graph is linked and packed.
            await pool.close();
          }
        },
        (compact) =>
          compactProjectAsync(compact, (batch) =>
            reply({ id, files: batch }, transferable(batch)),
          ),
      );
      reply({ id, parts });
    } catch (error) {
      reply({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
