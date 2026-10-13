export type NodeId = string;

export type NodeKind =
  | "module"
  | "function"
  | "class"
  | "code"
  | "call"
  | "external"
  | "condition"
  | "loop"
  | "block"
  | "folder"
  | "file";

export type ExternalCategory =
  | "HTTP"
  | "BANCO"
  | "ARQUIVO"
  | "EMAIL"
  | "EXTERNO";

/** 1-based, inclusive. */
export interface LineRange {
  start: number;
  end: number;
}

export interface FlowNode {
  id: NodeId;
  kind: NodeKind;
  label: string;
  parentId: NodeId | null;
  range: LineRange;
  openable: boolean;
  target?: NodeId;
  callee?: string;
  category?: ExternalCategory;
  syntaxError?: { line: number };
  /** POSIX path relative to the root; only on `folder` and `file` nodes (`""` for the root). */
  path?: string;
}

export type EdgeKind = "calls" | "next" | "branch" | "imports";

export interface FlowEdge {
  id: string;
  kind: EdgeKind;
  source: NodeId;
  target: NodeId;
  label?: string;
}

export interface Graph {
  language: "python";
  empty: boolean;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Present only on a project graph; `name` is the root folder name. */
  project?: { name: string };
}

export interface Extractor {
  language: string;
  extract(source: string): Graph;
}
