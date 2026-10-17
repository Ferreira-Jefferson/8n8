import { parentPort, workerData } from "node:worker_threads";
import type { AnalysisSlice, LanguageAnalysis } from "@8n8/model";
import type { AnalysisReply, AnalysisRequest } from "./analysis-pool";
import { type BuilderData, serveBuilds } from "./build-worker";
import { languagePlugins } from "./plugins";

// Entry of a worker thread (its own bundle, next to the core's): runs plugins for the pool, or, started with the role "builder", whole builds.

/** Files per message: small enough that the main thread reads each one in a few milliseconds. */
const BATCH = 20;

const slices = new Map<number, AnalysisSlice>();

function reply(message: AnalysisReply): void {
  parentPort?.postMessage(message);
}

function plugin(id: string) {
  const found = languagePlugins.find((p) => p.id === id);
  if (!found) throw new Error(`unknown plugin "${id}"`);
  return found;
}

function sliceOf(id: number): AnalysisSlice {
  const found = slices.get(id);
  if (!found) throw new Error(`unknown slice ${id}`);
  return found;
}

function replyAnalysis(id: number, analysis: LanguageAnalysis): void {
  const { files, imports, offers, requests } = analysis;
  for (let i = 0; i < files.length; i += BATCH) {
    reply({ id, files: files.slice(i, i + BATCH) });
  }
  reply({ id, done: { imports, offers, requests } });
}

function handle(request: AnalysisRequest & { id: number }): void {
  const { id } = request;
  switch (request.op) {
    case "open": {
      const open = plugin(request.pluginId).openSlice;
      if (!open) throw new Error(`plugin "${request.pluginId}" has no slices`);
      slices.set(request.slice, open(request.files));
      reply({ id, result: null });
      break;
    }
    case "contribute":
      reply({ id, result: sliceOf(request.slice).contribute() });
      break;
    case "analyze":
      replyAnalysis(id, sliceOf(request.slice).analyze(request.contributions));
      break;
    case "dispose":
      slices.get(request.slice)?.dispose();
      slices.delete(request.slice);
      reply({ id, result: null });
      break;
    case "run":
      replyAnalysis(id, plugin(request.pluginId).analyze(request.files));
      break;
  }
}

/** Answers the requests of the pool: one plugin step at a time. */
function serveAnalysis(): void {
  parentPort?.on("message", (request: AnalysisRequest & { id: number }) => {
    try {
      handle(request);
    } catch (error) {
      reply({
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

const builder = workerData as BuilderData | null;
if (builder?.role === "builder") serveBuilds(builder);
else serveAnalysis();
