import { createHash } from "node:crypto";
import type {
  FileContribution,
  IgnoredFile,
  LanguagePlugin,
  SourceFile,
} from "@8n8/model";
import {
  analyzeIsolating,
  failedGraph,
  groupByPlugin,
  manifestPlugin,
  splitFiles,
  validateAnalysis,
} from "@8n8/project";
import type { AnalysisCache, FileResult } from "./analysis-cache";
import {
  assemble,
  type GroupResult,
  type PackContext,
  type PackedAnalysis,
  packAnalysis,
  packFile,
} from "./project-pack";
import { fileOfId, type StoreParts } from "./project-store";

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
  contribute(): Promise<FileContribution[]>;
  analyze(
    contributions: FileContribution[],
    pack: PackRequest,
  ): Promise<PackedAnalysis>;
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
    // The slices are contiguous and sorted, so the flat list is sorted by path.
    const contributions = (
      await Promise.all(handles.map((h) => h.contribute()))
    ).flat();
    return join(
      await Promise.all(handles.map((h) => h.analyze(contributions, pack))),
    );
  } finally {
    for (const handle of handles) handle.dispose();
  }
}

const sha1 = (text: string): string =>
  createHash("sha1").update(text).digest("hex");

/**
 * The packed files of a slice with what belongs to each: its `imports` wires, offers and requests. The plugin
 * must give those lists grouped by file, in the order of its files: the cache keeps them by file, and the join
 * must see them in the same order as without the cache.
 */
function resultsOf(
  packed: PackedAnalysis,
  paths: ReadonlySet<string>,
): Map<string, FileResult> {
  const byPath = new Map<string, FileResult>();
  for (const file of packed.files) {
    byPath.set(file.path, { file, imports: [], offers: [], requests: [] });
  }
  const owner = (id: string): FileResult => {
    const found = byPath.get(fileOfId(id, paths));
    if (found === undefined) throw new Error(`no file of the slice owns ${id}`);
    return found;
  };
  for (const e of packed.imports) owner(e.source).imports.push(e);
  for (const o of packed.offers) owner(o.nodeId).offers.push(o);
  for (const r of packed.requests) owner(r.nodeId).requests.push(r);
  const ordered = <T>(pick: (r: FileResult) => T[], given: T[]): boolean => {
    const flat = packed.files.flatMap((f) =>
      pick(byPath.get(f.path) as FileResult),
    );
    return flat.length === given.length && flat.every((x, i) => x === given[i]);
  };
  if (
    !ordered((r) => r.imports, packed.imports) ||
    !ordered((r) => r.offers, packed.offers) ||
    !ordered((r) => r.requests, packed.requests)
  ) {
    throw new Error("wires, offers or requests out of the order of the files");
  }
  return byPath;
}

/**
 * One language through the workers, keeping each file's work on disk. The files whose contribution is not
 * cached are parsed (phase 1) and the contribution is kept. A file's result is cached under its contribution key
 * and the hash of the whole project context (every contribution of the language and every path): the files without
 * a result are analyzed (phase 2). A file with both cached is never parsed, and when nothing is missing no worker starts.
 * Answers as `runGroup` does, file by file in the order of `group`.
 */
async function runGroupCached(
  plugin: LanguagePlugin,
  group: SourceFile[],
  runner: PackingRunner,
  pack: PackRequest,
  paths: ReadonlySet<string>,
  cache: AnalysisCache,
): Promise<PackedAnalysis> {
  const base = `${plugin.id}|${plugin.cacheVersion}`;
  const keys = group.map((f) => `${base}|${f.path}|${sha1(f.source)}`);
  const texts = cache.contributions(keys);
  const indexOf = new Map(group.map((f, i) => [f.path, i]));
  const opened: PackingSlice[] = [];
  const open = (indices: number[]): PackingSlice[] => {
    const slices = splitFiles(
      indices.map((i) => group[i] as SourceFile),
      runner.size,
    ).map((files) => runner.openPackedSlice(plugin, files));
    opened.push(...slices);
    return slices;
  };
  try {
    // Phase 1, for the files with no cached contribution.
    const fresh = texts.flatMap((t, i) => (t === undefined ? [i] : []));
    const isFresh = new Set(fresh);
    const parsing = open(fresh);
    const made = (await Promise.all(parsing.map((h) => h.contribute()))).flat();
    if (
      made.length !== fresh.length ||
      made.some((c, k) => c.path !== group[fresh[k] as number]?.path)
    ) {
      throw new Error(
        "a slice gave contributions for other files than its own",
      );
    }
    made.forEach((c, k) => {
      const text = JSON.stringify(c.data);
      if (text === undefined) throw new Error(`no contribution for ${c.path}`);
      texts[fresh[k] as number] = text;
      cache.putContribution(keys[fresh[k] as number] as string, text);
    });

    const context = createHash("sha1").update(`${base}\0`);
    for (const path of [...paths].sort()) context.update(`${path}\0`);
    context.update("\0contributions\0");
    for (const [i, f] of group.entries()) {
      context.update(`${f.path}\0${texts[i]}\0`);
    }
    const contextHash = context.digest("hex");

    // Phase 2, for the files with no cached result: the ones just parsed, and the ones the context changed under.
    const resultKeys = keys.map((key) => `${key}|${contextHash}`);
    // A manifest (package.json) gives a contribution and no result.
    const manifest = group.map(
      (f) => manifestPlugin(f.path, [plugin]) !== undefined,
    );
    const results = group.map((f, i) =>
      isFresh.has(i) || manifest[i]
        ? undefined
        : cache.result(resultKeys[i] as string, f.source),
    );
    const later = results.flatMap((r, i) =>
      r === undefined && !isFresh.has(i) && !manifest[i] ? [i] : [],
    );
    const slices = [...parsing, ...open(later)];
    let given: FileContribution[] | undefined;
    const contributions = () => {
      given ??= group.map((f, i) => ({
        path: f.path,
        data: JSON.parse(texts[i] as string) as unknown,
      }));
      return given;
    };
    await Promise.all(
      slices.map(async (slice) => {
        for (const [path, result] of resultsOf(
          await slice.analyze(contributions(), pack),
          paths,
        )) {
          const i = indexOf.get(path);
          if (i === undefined)
            throw new Error(`a file the slice was not given: ${path}`);
          results[i] = result;
          cache.putResult(resultKeys[i] as string, result);
        }
      }),
    );
    const done = results.flatMap((r, i) => {
      if (manifest[i]) return [];
      if (r === undefined) throw new Error(`no result for ${group[i]?.path}`);
      return [r];
    });
    return {
      files: done.map((r) => r.file),
      imports: done.flatMap((r) => r.imports),
      offers: done.flatMap((r) => r.offers),
      requests: done.flatMap((r) => r.requests),
    };
  } finally {
    for (const handle of opened) handle.dispose();
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
  /**
   * Keeps the work of each file between builds, for a plugin with `openSlice` and `cacheVersion`.
   * The caller flushes it once it has the answer (a flush writes to disk) and closes it.
   */
  cache?: AnalysisCache;
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
          const done =
            options.cache !== undefined &&
            plugin.openSlice !== undefined &&
            plugin.cacheVersion !== undefined
              ? await runGroupCached(
                  plugin,
                  group,
                  runner,
                  pack,
                  ctx.paths,
                  options.cache,
                )
              : await runGroup(plugin, group, runner, pack);
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
