import { parentPort, workerData } from "node:worker_threads";
import type {
  AnalysisSlice,
  LanguageAnalysis,
  LanguagePlugin,
  SourceFile,
} from "@8n8/model";
import type { AnalysisReply, AnalysisRequest } from "./analysis-pool";
import { type BuilderData, serveBuilds } from "./build-worker";
import { languagePlugins } from "./plugins";
import type { PackRequest } from "./project-build";
import { type PackedAnalysis, packAnalysis } from "./project-pack";

// Entry of a worker thread (its own bundle, next to the core's): runs plugins for the pool, or, started with the role "builder", whole builds.

/** Files per message: small enough that the thread that reads each message does it in a few milliseconds. */
const BATCH = 20;

/** A slice with the files and the plugin it was opened with: packing checks that the plugin returns only those files. */
const slices = new Map<
  number,
  { slice: AnalysisSlice; files: SourceFile[]; plugin: LanguagePlugin }
>();

function reply(message: AnalysisReply, transfer: ArrayBuffer[] = []): void {
  parentPort?.postMessage(message, transfer);
}

function plugin(id: string) {
  const found = languagePlugins.find((p) => p.id === id);
  if (!found) throw new Error(`unknown plugin "${id}"`);
  return found;
}

function sliceOf(id: number) {
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

/** The same answer as `replyAnalysis`, with each file packed here: the graphs stay in this thread and the blobs move without a copy. */
function replyPacked(
  id: number,
  plugin: LanguagePlugin,
  files: SourceFile[],
  analysis: LanguageAnalysis,
  pack: PackRequest,
): void {
  const packed: PackedAnalysis = packAnalysis(
    plugin,
    { paths: new Set(pack.paths) },
    files,
    analysis,
  );
  for (let i = 0; i < packed.files.length; i += BATCH) {
    const batch = packed.files.slice(i, i + BATCH);
    reply(
      { id, files: batch },
      batch.map((f) => f.blob.buffer as ArrayBuffer),
    );
  }
  reply({
    id,
    done: {
      imports: packed.imports,
      offers: packed.offers,
      requests: packed.requests,
    },
  });
}

function handle(request: AnalysisRequest & { id: number }): void {
  const { id } = request;
  switch (request.op) {
    case "open": {
      const opener = plugin(request.pluginId);
      if (!opener.openSlice) {
        throw new Error(`plugin "${request.pluginId}" has no slices`);
      }
      slices.set(request.slice, {
        slice: opener.openSlice(request.files),
        files: request.files,
        plugin: opener,
      });
      reply({ id, result: null });
      break;
    }
    case "contribute":
      reply({ id, result: sliceOf(request.slice).slice.contribute() });
      break;
    case "analyze": {
      const { slice, files, plugin: opener } = sliceOf(request.slice);
      const analysis = slice.analyze(request.contributions);
      if (request.pack === undefined) replyAnalysis(id, analysis);
      else replyPacked(id, opener, files, analysis, request.pack);
      break;
    }
    case "dispose":
      slices.get(request.slice)?.slice.dispose();
      slices.delete(request.slice);
      reply({ id, result: null });
      break;
    case "run": {
      const found = plugin(request.pluginId);
      const analysis = found.analyze(request.files);
      if (request.pack === undefined) replyAnalysis(id, analysis);
      else replyPacked(id, found, request.files, analysis, request.pack);
      break;
    }
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
