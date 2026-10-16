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

/** What the screen receives when it opens a folder: no source code, which it asks for by file. */
export interface ProjectResponse {
  name: string;
  graph: Graph;
  ignored: IgnoredFile[];
  /** Names this build: the file requests carry it, and a folder that changed answers 409. */
  version?: string;
}

/** What the server keeps of a folder it read: the response and the source of every file. */
export interface ProjectData extends ProjectResponse {
  files: SourceFile[];
}

/** The source of one file of a project. */
export interface ProjectFileResponse {
  path: string;
  source: string;
}

export interface ProjectExtractor {
  extractProject(files: SourceFile[]): Graph;
}

/**
 * Walks up `parentId` from `id` to the enclosing `file` node. A caller that asks
 * many times passes `byId`, made once, because making it walks every node.
 */
export function fileNodeOf(
  graph: Graph,
  id: NodeId,
  byId: ReadonlyMap<NodeId, FlowNode> = new Map(
    graph.nodes.map((n) => [n.id, n]),
  ),
): FlowNode | undefined {
  let node = byId.get(id);
  while (node) {
    if (node.kind === "file") return node;
    node = node.parentId === null ? undefined : byId.get(node.parentId);
  }
  return undefined;
}
