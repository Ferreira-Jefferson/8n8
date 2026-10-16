import {
  type FlowEdge,
  type FlowNode,
  fileId,
  folderId,
  type Graph,
  type LanguageAnalysis,
  type LanguagePlugin,
  type LinkRequest,
  type NodeId,
  type Offer,
  type SourceFile,
} from "@8n8/model";
import { pluginForPath } from "./detect";
import { baseName, byCode, dirOf, lastLine, layoutProject } from "./layout";
import { validateAnalysis } from "./validate";

export interface ProjectBuild {
  graph: Graph;
  /** What the files expose and look for, as the plugins reported. Nothing is matched here. */
  offers: Offer[];
  requests: LinkRequest[];
}

const EMPTY: LanguageAnalysis = {
  files: [],
  imports: [],
  offers: [],
  requests: [],
};

/** Each file goes to the first plugin that serves its extension; the rest are ignored. */
export function groupByPlugin(
  files: SourceFile[],
  plugins: LanguagePlugin[],
): Map<LanguagePlugin, SourceFile[]> {
  const groups = new Map<LanguagePlugin, SourceFile[]>();
  for (const file of [...files].sort((a, b) => byCode(a.path, b.path))) {
    const plugin = pluginForPath(file.path, plugins);
    if (plugin === undefined) continue;
    groups.set(plugin, [...(groups.get(plugin) ?? []), file]);
  }
  return groups;
}

function failure(plugin: LanguagePlugin, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(`plugin "${plugin.id}" failed to analyze: ${reason}`, {
    cause: error,
  });
}

function throws(run: () => unknown): boolean {
  try {
    run();
    return false;
  } catch {
    return true;
  }
}

/**
 * Runs `analyze`. When it throws, probes the files one by one: the ones that
 * throw alone are the failed ones (2.3), and the rest are analyzed together.
 * A failure that no single file explains is the plugin's, and it propagates.
 */
export function analyzeIsolating(
  plugin: LanguagePlugin,
  files: SourceFile[],
): { analysis: LanguageAnalysis; failed: SourceFile[] } {
  try {
    return { analysis: plugin.analyze(files), failed: [] };
  } catch (error) {
    const failed = files.filter((f) => throws(() => plugin.analyze([f])));
    if (failed.length === 0) throw failure(plugin, error);
    const rest = files.filter((f) => !failed.includes(f));
    try {
      return {
        analysis: rest.length === 0 ? EMPTY : plugin.analyze(rest),
        failed,
      };
    } catch (again) {
      throw failure(plugin, again);
    }
  }
}

/** A file the plugin could not read: a `file` node marked with a syntax error, no inner nodes. */
export function failedGraph(plugin: LanguagePlugin, file: SourceFile): Graph {
  return {
    language: plugin.id,
    empty: false,
    nodes: [
      {
        id: fileId(file.path),
        kind: "file",
        label: baseName(file.path),
        parentId: dirOf(file.path) === "" ? null : folderId(dirOf(file.path)),
        range: { start: 1, end: lastLine(file.source) },
        openable: true,
        path: file.path,
        syntaxError: { line: 1 },
      },
    ],
    edges: [],
  };
}

/** `mixed` when more than one language has files; with none, the only plugin's id. */
export function languageOf(
  used: LanguagePlugin[],
  all: LanguagePlugin[],
): string {
  if (used.length === 1) return used[0]?.id ?? "";
  if (used.length === 0 && all.length === 1) return all[0]?.id ?? "";
  return "mixed";
}

/**
 * Builds the graph of a project (PROJ-02, 03, 04, 09): each plugin analyzes
 * the files of its extensions, and the folders and files go in pre-order.
 * Offers and requests come back untouched; matching them is not done here.
 */
export function analyzeProject(
  files: SourceFile[],
  plugins: LanguagePlugin[],
): ProjectBuild {
  const graphs = new Map<string, Graph>();
  const fileEdges: FlowEdge[] = [];
  const imports = new Map<string, FlowEdge>();
  const offers: Offer[] = [];
  const requests: LinkRequest[] = [];
  const groups = groupByPlugin(files, plugins);

  for (const [plugin, group] of groups) {
    const { analysis, failed } = analyzeIsolating(plugin, group);
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
  }

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

export function buildProject(
  files: SourceFile[],
  plugins: LanguagePlugin[],
): Graph {
  return analyzeProject(files, plugins).graph;
}
