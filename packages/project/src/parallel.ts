import type {
  FlowEdge,
  FlowNode,
  Graph,
  LanguageAnalysis,
  LanguagePlugin,
  LinkRequest,
  NodeId,
  Offer,
  SourceFile,
} from "@8n8/model";
import {
  analyzeIsolating,
  analyzeProject,
  failedGraph,
  groupByPlugin,
  languageOf,
  type ProjectBuild,
} from "./build";
import { layoutProject } from "./layout";
import { validateAnalysis } from "./validate";

/** A slice of a plugin's files, kept by one worker thread until `dispose`. */
export interface SliceHandle {
  contribute(): Promise<unknown>;
  analyze(contributions: unknown[]): Promise<LanguageAnalysis>;
  dispose(): void;
}

/** Where the plugins run: worker threads. Each answer must equal what the plugin gives in this thread. */
export interface AnalysisRunner {
  /** How many slices a plugin with `openSlice` gets; usually the number of workers. */
  size: number;
  /** The whole group in one piece, for a plugin without `openSlice`. */
  analyze(
    plugin: LanguagePlugin,
    files: SourceFile[],
  ): Promise<LanguageAnalysis>;
  /** One slice, held by one worker; each call goes to the next worker. */
  openSlice(plugin: LanguagePlugin, files: SourceFile[]): SliceHandle;
}

export interface ParallelOptions {
  runner: AnalysisRunner;
  /** Below this many files the sequential path is faster than waking the workers. */
  minFiles: number;
  /** A group the workers could not analyze goes on in sequence, with the same answer: this says why. */
  onFallback?: (error: unknown) => void;
}

/** The slices of one plugin, joined in slice order: the whole analysis. */
function join(parts: LanguageAnalysis[]): LanguageAnalysis {
  return {
    files: parts.flatMap((p) => p.files),
    imports: parts.flatMap((p) => p.imports),
    offers: parts.flatMap((p) => p.offers),
    requests: parts.flatMap((p) => p.requests),
  };
}

/** `count` contiguous slices of `files`, balanced by source size; none is empty. */
function split(files: SourceFile[], count: number): SourceFile[][] {
  const total = files.reduce((sum, f) => sum + f.source.length + 1, 0);
  const slices: SourceFile[][] = Array.from({ length: count }, () => []);
  let before = 0;
  for (const file of files) {
    const size = file.source.length + 1;
    const at = Math.floor(((before + size / 2) * count) / total);
    slices[Math.min(count - 1, at)]?.push(file);
    before += size;
  }
  return slices.filter((slice) => slice.length > 0);
}

/**
 * One group through the workers. Phase 1: every slice parses its files and gives its part
 * of the project context. Phase 2: every slice builds its graphs with the context of all.
 */
async function runGroup(
  plugin: LanguagePlugin,
  group: SourceFile[],
  runner: AnalysisRunner,
): Promise<LanguageAnalysis> {
  if (plugin.openSlice === undefined) return runner.analyze(plugin, group);
  const handles = split(group, runner.size).map((files) =>
    runner.openSlice(plugin, files),
  );
  try {
    const contributions = await Promise.all(handles.map((h) => h.contribute()));
    const parts = await Promise.all(
      handles.map((h) => h.analyze(contributions)),
    );
    return join(parts);
  } finally {
    for (const handle of handles) handle.dispose();
  }
}

/**
 * The same result as `analyzeProject`, with the plugins running in worker threads:
 * a plugin with `openSlice` in slices at once, any other in one piece.
 * When a worker fails, the group goes back to the sequential path, so a bad file
 * still ends as a `file` node with a syntax error (2.3) and a plugin bug as the same error.
 */
export async function analyzeProjectParallel(
  files: SourceFile[],
  plugins: LanguagePlugin[],
  options: ParallelOptions,
): Promise<ProjectBuild> {
  if (files.length < options.minFiles) return analyzeProject(files, plugins);
  const groups = groupByPlugin(files, plugins);
  const analyzed = await Promise.all(
    [...groups].map(async ([plugin, group]) => {
      try {
        return {
          analysis: await runGroup(plugin, group, options.runner),
          failed: [],
        };
      } catch (error) {
        options.onFallback?.(error);
        return analyzeIsolating(plugin, group);
      }
    }),
  );

  const graphs = new Map<string, Graph>();
  const fileEdges: FlowEdge[] = [];
  const imports = new Map<string, FlowEdge>();
  const offers: Offer[] = [];
  const requests: LinkRequest[] = [];
  [...groups].forEach(([plugin, group], i) => {
    const { analysis, failed } = analyzed[i] as {
      analysis: LanguageAnalysis;
      failed: SourceFile[];
    };
    validateAnalysis(
      plugin,
      group.filter((f) => !failed.includes(f)),
      analysis,
    );
    for (const { path, graph } of analysis.files) {
      graphs.set(path, graph);
      fileEdges.push(...graph.edges);
    }
    for (const file of failed) graphs.set(file.path, failedGraph(plugin, file));
    for (const edge of analysis.imports) {
      if (!imports.has(edge.id)) imports.set(edge.id, edge);
    }
    offers.push(...analysis.offers);
    requests.push(...analysis.requests);
  });

  const nodes: FlowNode[] = layoutProject(graphs);
  const seen = new Set<NodeId>();
  for (const node of nodes) {
    if (seen.has(node.id)) throw new Error(`duplicate node id: ${node.id}`);
    seen.add(node.id);
  }
  const graph: Graph = {
    language: languageOf([...groups.keys()], plugins),
    empty: nodes.length === 0,
    nodes,
    edges: [...fileEdges, ...imports.values()],
  };
  return { graph, offers, requests };
}
