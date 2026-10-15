import type { FlowNode, Graph, NodeId } from "./graph";

/** `path` is POSIX and relative to the project root. */
export interface SourceFile {
  path: string;
  source: string;
}

export type IgnoreReason = "too-large" | "not-utf8" | "unreadable" | "symlink";

export interface IgnoredFile {
  path: string;
  reason: IgnoreReason;
  /** A file over 1 MB and up to 20 MB: the screen offers to put it on the map (CLEAN-06). */
  addable?: boolean;
}

export interface ProjectResponse {
  name: string;
  graph: Graph;
  files: SourceFile[];
  ignored: IgnoredFile[];
}

export interface ProjectExtractor {
  extractProject(files: SourceFile[]): Graph;
}

/** Walks up `parentId` from `id` to the enclosing `file` node. */
export function fileNodeOf(graph: Graph, id: NodeId): FlowNode | undefined {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  let node = byId.get(id);
  while (node) {
    if (node.kind === "file") return node;
    node = node.parentId === null ? undefined : byId.get(node.parentId);
  }
  return undefined;
}
