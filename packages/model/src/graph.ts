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
  | "file"
  | "return";

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
  /**
   * Regra de abertura (VID-24): true em folder, file, module, function,
   * class, loop, block e call (com target). false em code, condition,
   * external e return.
   */
  openable: boolean;
  /** call: a função chamada. return: a função chamada pela expressão, se houver. */
  target?: NodeId;
  /** external: o nome chamado. return: o nome externo chamado pela expressão, se houver. */
  callee?: string;
  category?: ExternalCategory;
  syntaxError?: { line: number };
  /** POSIX path relative to the root; only on `folder` and `file` nodes (`""` for the root). */
  path?: string;
  /** function, class and module: the lines of its documentation comment (docstring, JSDoc), in the same absolute lines as `range`. */
  docstring?: LineRange;
}

/** `contains` is never in a `Graph`: the web draws it from the hub of a level. */
export type EdgeKind = "calls" | "next" | "branch" | "imports" | "contains";

export interface FlowEdge {
  id: string;
  kind: EdgeKind;
  source: NodeId;
  target: NodeId;
  label?: string;
}

export interface Graph {
  /** O `id` do plugin que extraiu o grafo; `mixed` num projeto com mais de uma linguagem. */
  language: string;
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
