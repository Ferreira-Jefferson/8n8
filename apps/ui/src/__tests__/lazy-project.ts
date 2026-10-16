import {
  type FileDetail,
  type FlowEdge,
  type FlowNode,
  type Graph,
  type IgnoredFile,
  type NodeId,
  type ProjectSkeleton,
  SEARCHABLE_KINDS,
  type SearchHit,
  searchText,
  searchWords,
  skeletonGraphOf,
} from "@8n8/model";

/** A project as a test writes it: the full graph and the source of each file. */
export interface FullProject {
  name: string;
  graph: Graph;
  ignored: IgnoredFile[];
  version?: string;
}

/** What the server answers for one file of a full graph: the file, its descendants, its own wires and the file of each outside target. */
export function detailFor(
  graph: Graph,
  path: string,
  source: string,
): FileDetail | undefined {
  const file = graph.nodes.find((n) => n.kind === "file" && n.path === path);
  if (!file) return undefined;
  const parents = new Map(graph.nodes.map((n) => [n.id, n.parentId]));
  const fileOf = (id: NodeId): NodeId | undefined => {
    for (
      let at: NodeId | null | undefined = id;
      at;
      at = parents.get(at) ?? null
    ) {
      if (graph.nodes.find((n) => n.id === at)?.kind === "file") return at;
    }
    return undefined;
  };
  const nodes: FlowNode[] = graph.nodes.filter((n) => fileOf(n.id) === file.id);
  const edges: FlowEdge[] = graph.edges.filter(
    (e) => fileOf(e.source) === file.id && fileOf(e.target) === file.id,
  );
  const refs: Record<NodeId, string> = {};
  for (const n of nodes) {
    const there = n.target === undefined ? undefined : fileOf(n.target);
    if (there === undefined || there === file.id) continue;
    const path = graph.nodes.find((f) => f.id === there)?.path;
    if (path !== undefined) refs[n.id] = path;
  }
  return { path, source, nodes, edges, refs };
}

/** The skeleton the server would answer for `project`, and the files it would then serve by `served`. */
export function lazySkeleton(
  project: FullProject,
  sourceOf: (path: string) => string,
  served: Map<string, FileDetail>,
): ProjectSkeleton {
  for (const n of project.graph.nodes) {
    if (n.kind !== "file" || n.path === undefined) continue;
    const detail = detailFor(project.graph, n.path, sourceOf(n.path));
    if (detail) served.set(n.path, detail);
  }
  return {
    name: project.name,
    ignored: project.ignored,
    version: project.version ?? "v1",
    stats: {
      files: project.graph.nodes.filter((n) => n.kind === "file").length,
      nodes: project.graph.nodes.length,
      edges: project.graph.edges.length,
    },
    graph: skeletonGraphOf(project.graph),
  };
}

/** What the server's search answers for a full graph: the searchable nodes that hold every word, with their parents from the top. */
export function searchHits(graph: Graph, query: string): SearchHit[] {
  const words = searchWords(query);
  if (words.length === 0) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.nodes
    .filter(
      (n) =>
        SEARCHABLE_KINDS.has(n.kind) &&
        words.every((w) => searchText(n).includes(w)),
    )
    .slice(0, 50)
    .map((node) => {
      const ancestry: NodeId[] = [];
      for (
        let at = node.parentId === null ? undefined : byId.get(node.parentId);
        at;
        at = at.parentId === null ? undefined : byId.get(at.parentId)
      ) {
        ancestry.unshift(at.id);
      }
      return { node, ancestry };
    });
}
