import type { IgnoredFile, LanguagePlugin, SourceFile } from "@8n8/model";
import {
  analyzeIsolating,
  failedGraph,
  groupByPlugin,
  splitFiles,
  validateAnalysis,
} from "@8n8/project";
import {
  assemble,
  type GroupResult,
  type PackContext,
  type PackedAnalysis,
  packAnalysis,
  packFile,
} from "./project-pack";
import type { StoreParts } from "./project-store";

/** What a build needs: the files the reader gave, and the names that go on the result. */
export interface BuildInput {
  name: string;
  files: SourceFile[];
  ignored: IgnoredFile[];
  /** Names this build (the reader's fingerprint of the files). */
  version: string;
}

/** Makes the store parts of a project; in the thread of the request, or in a worker thread with the same answer. */
export type Build = (
  input: BuildInput,
  plugins: LanguagePlugin[],
) => Promise<StoreParts>;

/** What the packing workers are asked for besides the files: the paths of the whole project. */
export interface PackRequest {
  paths: string[];
}

/** A slice of the files of a language, whose parse trees one worker keeps until `dispose`. */
export interface PackingSlice {
  contribute(): Promise<unknown>;
  analyze(contributions: unknown[], pack: PackRequest): Promise<PackedAnalysis>;
  dispose(): void;
}

/** Where the plugins run, and pack what they find: worker threads. */
export interface PackingRunner {
  /** How many slices a plugin with `openSlice` gets; usually the number of workers. */
  size: number;
  /** The whole group in one piece, for a plugin without `openSlice`. */
  runPacked(
    plugin: LanguagePlugin,
    files: SourceFile[],
    pack: PackRequest,
  ): Promise<PackedAnalysis>;
  openPackedSlice(plugin: LanguagePlugin, files: SourceFile[]): PackingSlice;
}

const contextOf = (files: readonly SourceFile[]): PackContext => ({
  paths: new Set(files.map((f) => f.path)),
});

/** One language, all in this thread: analyze (a file the plugin cannot read becomes a file node with a syntax error, 2.3), check, pack. */
function packGroupInThread(
  plugin: LanguagePlugin,
  group: SourceFile[],
  ctx: PackContext,
): GroupResult {
  const { analysis, failed } = analyzeIsolating(plugin, group);
  validateAnalysis(
    plugin,
    group.filter((f) => !failed.includes(f)),
    analysis,
  );
  const { files, imports, offers, requests } = packAnalysis(
    plugin,
    ctx,
    group,
    analysis,
  );
  return {
    plugin,
    packed: files,
    failed: failed.map((f) =>
      packFile(plugin, ctx, f.path, f.source, failedGraph(plugin, f)),
    ),
    imports,
    offers,
    requests,
  };
}

/** The slices of one language, joined in slice order: the whole analysis. */
function join(parts: PackedAnalysis[]): PackedAnalysis {
  return {
    files: parts.flatMap((p) => p.files),
    imports: parts.flatMap((p) => p.imports),
    offers: parts.flatMap((p) => p.offers),
    requests: parts.flatMap((p) => p.requests),
  };
}

/**
 * One language through the workers. Phase 1: every slice parses its files and gives its part of the
 * project context. Phase 2: every slice builds the graphs of its files with the context of all, and packs them.
 */
async function runGroup(
  plugin: LanguagePlugin,
  group: SourceFile[],
  runner: PackingRunner,
  pack: PackRequest,
): Promise<PackedAnalysis> {
  if (plugin.openSlice === undefined)
    return runner.runPacked(plugin, group, pack);
  const handles = splitFiles(group, runner.size).map((files) =>
    runner.openPackedSlice(plugin, files),
  );
  try {
    const contributions = await Promise.all(handles.map((h) => h.contribute()));
    return join(
      await Promise.all(handles.map((h) => h.analyze(contributions, pack))),
    );
  } finally {
    for (const handle of handles) handle.dispose();
  }
}

/** The plugins run in this thread. */
export const buildInThread: Build = async (input, plugins) => {
  const ctx = contextOf(input.files);
  const groups = [...groupByPlugin(input.files, plugins)].map(
    ([plugin, group]) => packGroupInThread(plugin, group, ctx),
  );
  return assemble({ ...input, groups, plugins });
};

export interface StreamedOptions {
  /** A language the workers could not analyze goes on in this thread, with the same answer: this says why. */
  onFallback?: (error: unknown) => void;
  /** Called when every language is analyzed and packed, before the join: the workers can go. */
  analyzed?: () => Promise<void>;
}

/**
 * The same parts as `buildInThread`, with the plugins running in worker threads, which also pack the files
 * they analyze: a graph never crosses a thread. When a worker fails, the language goes back to this thread.
 */
export async function buildStreamed(
  input: BuildInput,
  plugins: LanguagePlugin[],
  runner: PackingRunner,
  options: StreamedOptions = {},
): Promise<StoreParts> {
  const ctx = contextOf(input.files);
  const pack: PackRequest = { paths: input.files.map((f) => f.path) };
  let groups: GroupResult[];
  try {
    groups = await Promise.all(
      [...groupByPlugin(input.files, plugins)].map(async ([plugin, group]) => {
        try {
          const done = await runGroup(plugin, group, runner, pack);
          return {
            plugin,
            packed: done.files,
            failed: [],
            imports: done.imports,
            offers: done.offers,
            requests: done.requests,
          };
        } catch (error) {
          options.onFallback?.(error);
          return packGroupInThread(plugin, group, ctx);
        }
      }),
    );
  } finally {
    await options.analyzed?.();
  }
  return assemble({ ...input, groups, plugins });
}
