import type { FlowEdge, FlowNode, Graph, NodeId } from "./graph";

/** `path` is POSIX and relative to the project root. */
export interface SourceFile {
  path: string;
  source: string;
}

/** `output-folder`: a build output folder (`dist`, `build`…) at the root of the project or of a package. `unsupported`: the files of a code extension no plugin reads. */
export type IgnoreReason =
  | "too-large"
  | "not-utf8"
  | "unreadable"
  | "symlink"
  | "output-folder"
  | "unsupported";

export interface IgnoredFile {
  /** For `unsupported`, the extension as a pattern (`*.js`). */
  path: string;
  reason: IgnoreReason;
  /** A file over 1 MB and up to 20 MB: the screen offers to put it on the map (CLEAN-06). */
  addable?: boolean;
  /** For `unsupported`: how many files have the extension. */
  count?: number;
}

/** What the server keeps of a folder it read: the whole graph and the source of every file. The screen receives a `ProjectSkeleton`, never this. */
export interface ProjectData {
  name: string;
  graph: Graph;
  ignored: IgnoredFile[];
  /** Names this build: the file requests carry it, and a folder that changed answers 409. */
  version?: string;
  files: SourceFile[];
}

/** The folders and files of a project, the wires between files and the counts: what the screen needs to draw the top. The inside of a file comes by `FileDetail`. */
export interface ProjectSkeleton {
  name: string;
  ignored: IgnoredFile[];
  stats: { files: number; nodes: number; edges: number };
  version: string;
  /** `nodes` hold only `folder` and `file`; `edges` hold every `imports` and, for calls and inheritance across files, one wire per pair of files and kind. */
  graph: Graph;
}

/** The inside of one file: its source, its nodes and the wires between them. */
export interface FileDetail {
  path: string;
  source: string;
  /** The `file` node and all its descendants, with the same ids as the full graph. */
  nodes: FlowNode[];
  /** Only the wires with both ends in the file. */
  edges: FlowEdge[];
  /** The file of each node whose `target` lies outside this file. */
  refs: Record<NodeId, string>;
}

/** One match of a search: the node and the ids of its parents, from the top. */
export interface SearchHit {
  node: FlowNode;
  ancestry: NodeId[];
  /** A name found inside the node, which has no node of its own: a route (`GET /api/x`), a top-level constant or type. */
  name?: string;
  /** The line of `name`. */
  line?: number;
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
