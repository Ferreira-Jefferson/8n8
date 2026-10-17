import {
  type FlowEdge,
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
import { dirOf, lastLine } from "./layout";

/** The parent a file node must have: its folder, or none for a file in the root. */
function expectedParent(path: string): NodeId | null {
  return dirOf(path) === "" ? null : folderId(dirOf(path));
}

/**
 * Checks what a plugin returned before the project is built (2.4): a plugin
 * with a bug gives a clear error, not a broken screen.
 */
export function validateAnalysis(
  plugin: LanguagePlugin,
  files: SourceFile[],
  analysis: LanguageAnalysis,
): void {
  const sources = new Map(files.map((f) => [f.path, f.source]));
  const seen = new Set<string>();
  const allIds = new Set<NodeId>();
  for (const { path, graph } of analysis.files) {
    const source = sources.get(path);
    if (source === undefined)
      failAnalysis(plugin, path, "a file it was not given");
    if (seen.has(path)) failAnalysis(plugin, path, "the file appears twice");
    seen.add(path);
    for (const id of validateFileGraph(plugin, path, source, graph)) {
      allIds.add(id);
    }
  }
  for (const f of files) {
    if (!seen.has(f.path))
      failAnalysis(plugin, f.path, "no graph for this file");
  }

  const wires: [string, FlowEdge][] = [
    ...analysis.files.flatMap((f): [string, FlowEdge][] =>
      f.graph.edges.map((e) => [f.path, e]),
    ),
    ...analysis.imports.map((e): [string, FlowEdge] => ["imports", e]),
  ];
  validateWires(plugin, wires, allIds);
  validateLinks(plugin, [...analysis.offers, ...analysis.requests], allIds);
}

/**
 * The checks of one file's graph, which need nothing from the other files: the file node, the ids,
 * the parents, the lines. Gives the ids of the file, in the order of its nodes.
 */
export function validateFileGraph(
  plugin: Pick<LanguagePlugin, "id">,
  path: string,
  source: string,
  graph: Graph,
): Set<NodeId> {
  const [head] = graph.nodes;
  if (head?.id !== fileId(path) || head.kind !== "file") {
    failAnalysis(
      plugin,
      path,
      `the first node must be the file node ${fileId(path)}`,
    );
  }
  if (head.parentId !== expectedParent(path)) {
    failAnalysis(
      plugin,
      path,
      `the file node must have the parent ${expectedParent(path)}`,
    );
  }
  const ids = new Set<NodeId>();
  for (const node of graph.nodes) {
    if (ids.has(node.id))
      failAnalysis(plugin, path, `duplicate node id ${node.id}`);
    ids.add(node.id);
  }
  const last = lastLine(source);
  for (const node of graph.nodes) {
    if (node !== head && !ids.has(node.parentId ?? "")) {
      failAnalysis(
        plugin,
        path,
        `node ${node.id} has a parent that does not exist`,
      );
    }
    const { start, end } = node.range;
    if (start < 1 || end < start || end > last) {
      failAnalysis(
        plugin,
        path,
        `node ${node.id} has the lines ${start}-${end}, outside 1-${last}`,
      );
    }
    const line = node.syntaxError?.line;
    if (line !== undefined && (line < 1 || line > last)) {
      failAnalysis(
        plugin,
        path,
        `node ${node.id} has a syntax error on line ${line}`,
      );
    }
  }
  return ids;
}

/** Every end of every wire must be a node of the analysis; `where` names the file the wire came from. */
export function validateWires(
  plugin: Pick<LanguagePlugin, "id">,
  wires: readonly (readonly [string, FlowEdge])[],
  allIds: ReadonlySet<NodeId>,
): void {
  for (const [where, edge] of wires) {
    for (const end of [edge.source, edge.target]) {
      if (!allIds.has(end)) {
        failAnalysis(
          plugin,
          where,
          `edge ${edge.id} points to ${end}, which does not exist`,
        );
      }
    }
  }
}

/** Every offer and request must name a node of the analysis. */
export function validateLinks(
  plugin: Pick<LanguagePlugin, "id">,
  links: readonly (Offer | LinkRequest)[],
  allIds: ReadonlySet<NodeId>,
): void {
  for (const link of links) {
    if (!allIds.has(link.nodeId)) {
      failAnalysis(
        plugin,
        link.channel,
        `${link.key} points to ${link.nodeId}, which does not exist`,
      );
    }
  }
}

export function failAnalysis(
  plugin: Pick<LanguagePlugin, "id">,
  where: string,
  reason: string,
): never {
  throw new Error(
    `plugin "${plugin.id}" returned an invalid analysis for ${where}: ${reason}`,
  );
}
