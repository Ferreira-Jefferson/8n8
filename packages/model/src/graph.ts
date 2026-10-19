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
  /** Only on a `file` of a skeleton, whose inner nodes are not loaded: how many nodes its level shows. */
  size?: number;
}

/**
 * `contains` is never in a `Graph`: the UI draws it from the hub of a level.
 * `extends`: from the child class to its base class, both defined in the
 * snippet or the project (a base from outside makes no edge).
 */
export type EdgeKind =
  | "calls"
  | "next"
  | "branch"
  | "imports"
  | "extends"
  | "contains";

/** A label the system writes (not the user's code): the screen says it in the language of the system. */
export type EdgeLabelKey =
  | "true"
  | "false"
  | "default"
  | "none"
  | "name"
  | "process";

export interface FlowEdge {
  id: string;
  kind: EdgeKind;
  source: NodeId;
  target: NodeId;
  /** What the code says (a condition, a case, `HTTP GET /rota`) or, with `labelKey`, a Portuguese fallback. */
  label?: string;
  /** Set when the system wrote the label: the screen shows its own words for the key, never `label`. */
  labelKey?: EdgeLabelKey;
  /** Set when the code does not prove the target; on a joined wire, the first of its links to check. */
  toCheck?: ToCheck;
  /** Only on a wire that joins wires: how many of the links it holds the code proves, and how many are to check. */
  links?: LinkCount;
}

/**
 * Why the code does not prove the target of a link.
 * `dynamic-base`: the URL starts with a value known only at run time.
 * `param-route`: a literal segment of the URL matches only a parameter of the route (`/metrics` and `/{slug}`).
 * `ambiguous`: more than one target matches; the link goes to each of them.
 * `name-only`: the link stands on a shared name only, between languages.
 */
export type ToCheckReason =
  | "dynamic-base"
  | "param-route"
  | "ambiguous"
  | "name-only";

/** What to check on a wire the code does not prove: why, and where the call is. */
export interface ToCheck {
  reason: ToCheckReason;
  /** Only with `dynamic-base`: the code the value comes from, as written (`config.baseUrl`, `process.env.API_URL`). */
  code?: string;
  /** Only with `ambiguous`: how many targets match. */
  targets?: number;
  /** The file of the call, relative to the root. */
  path: string;
  line: number;
}

export interface LinkCount {
  proven: number;
  toCheck: number;
}

/** The links a wire holds: its `links`, or one for a wire of the links package (`link:` id); undefined for any other wire. */
export function linksOf(edge: FlowEdge): LinkCount | undefined {
  if (edge.links) return edge.links;
  if (!edge.id.startsWith("link:")) return undefined;
  return edge.toCheck ? { proven: 0, toCheck: 1 } : { proven: 1, toCheck: 0 };
}

/**
 * Joins `edge` into `joined`, a wire that stands for it and for others: adds up their links, and keeps the
 * first link to check, so a link to check never hides a proven one, nor the other way round.
 */
export function joinWire(joined: FlowEdge, edge: FlowEdge): void {
  const a = linksOf(joined);
  const b = linksOf(edge);
  if (b) {
    joined.links = a
      ? { proven: a.proven + b.proven, toCheck: a.toCheck + b.toCheck }
      : b;
  }
  if (edge.toCheck && !joined.toCheck) joined.toCheck = edge.toCheck;
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
