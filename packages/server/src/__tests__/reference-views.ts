// The views of a project as they were when the server kept the whole graph: the reference the packed store must answer like.
import {
  type FileDetail,
  type FlowNode,
  type NodeId,
  type ProjectSkeleton,
  SEARCHABLE_KINDS,
  type SearchHit,
  searchText,
  searchWords,
  skeletonGraphOf,
} from "@8n8/model";
import { indexOf, type ProjectRead } from "./reference-index";

type Found = Extract<ProjectRead, { kind: "ok" }>;

const skeletons = new WeakMap<Found, ProjectSkeleton>();

/** The folders and files, the wires between files and the counts (the top of the map). */
export function skeletonOf(read: Found): ProjectSkeleton {
  const found = skeletons.get(read);
  if (found) return found;
  const { name, graph, ignored, version } = read.response;
  const skeleton: ProjectSkeleton = {
    name,
    ignored,
    stats: {
      files: graph.nodes.filter((n) => n.kind === "file").length,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    },
    version: version ?? "",
    graph: skeletonGraphOf(graph),
  };
  skeletons.set(read, skeleton);
  return skeleton;
}

/** The inside of one file; `undefined` when the project has no such file. */
export function detailOf(read: Found, path: string): FileDetail | undefined {
  const index = indexOf(read);
  const source = index.sources.get(path);
  if (source === undefined) return undefined;
  const nodes = index.nodesByFile.get(path) ?? [];
  const refs: Record<NodeId, string> = {};
  for (const n of nodes) {
    if (n.target === undefined) continue;
    const there = index.filePathOf(n.target);
    if (there !== "" && there !== path) refs[n.id] = there;
  }
  return {
    path,
    source,
    nodes,
    edges: index.edgesByFile.get(path) ?? [],
    refs,
  };
}

interface Searchable {
  node: FlowNode;
  text: string;
}

const searchIndexes = new WeakMap<Found, Searchable[]>();

/** Most hits a search answers. */
export const MAX_HITS = 50;

/** The nodes that hold every word of `query` in their name, in the order of the graph. */
export function searchOf(
  read: Found,
  query: string,
  limit = MAX_HITS,
): SearchHit[] {
  const index = indexOf(read);
  let list = searchIndexes.get(read);
  if (!list) {
    list = read.response.graph.nodes
      .filter((n) => SEARCHABLE_KINDS.has(n.kind))
      .map((node) => ({ node, text: searchText(node) }));
    searchIndexes.set(read, list);
  }
  const words = searchWords(query);
  if (words.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const { node, text } of list) {
    if (!words.every((w) => text.includes(w))) continue;
    const ancestry: NodeId[] = [];
    for (
      let parent =
        node.parentId === null ? undefined : index.byId.get(node.parentId);
      parent;
      parent =
        parent.parentId === null ? undefined : index.byId.get(parent.parentId)
    ) {
      ancestry.unshift(parent.id);
    }
    hits.push({ node, ancestry });
    if (hits.length === limit) break;
  }
  return hits;
}
