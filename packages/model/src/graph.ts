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
  | "block";

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
}

export type EdgeKind = "calls" | "next" | "branch";

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
}

export interface Extractor {
  language: string;
  extract(source: string): Graph;
}
