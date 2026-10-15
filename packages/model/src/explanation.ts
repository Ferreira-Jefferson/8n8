import type { ExternalCategory, LineRange, NodeId, NodeKind } from "./graph.ts";

export type Severity = "alta" | "media" | "baixa";

/** Positional id inside one draft: s1.., i1.., o1.., g1.. */
export type ClaimId = string;

/** One judged statement. `lines` are absolute in the response. */
export interface Claim {
  id: ClaimId;
  text: string;
  lines: number[];
}

export interface Suggestion {
  id: ClaimId;
  command: string;
  reason: string;
  line: number;
  severity: Severity;
  lines: number[];
}

/** The summary part of a node's explanation; the suggestions are a request of their own (CFG-01, CFG-02). */
export interface Summary {
  /** The kept sentences joined by a space. */
  summary: string;
  sentences: Claim[];
  inputs: Claim[];
  outputs: Claim[];
}

/** The two requests a node's explanation is made of (AD-023). */
export type ExplainPart = "summary" | "suggestions";

/** "full" = "Revisado"; "cut" = "Revisado com cortes". */
export type ReviewStatus = "full" | "cut";

export type UpdateReason = "code" | "neighbours" | "model-or-prompt";

/** Os nós que o servidor explica: todos menos pasta e arquivo (VID-28). */
export type ExplainKind = Exclude<NodeKind, "folder" | "file">;

/** "full" = resumo de função, classe ou código solto; "step" = resumo de passo (VID-28, VID-29). */
export type ExplainStyle = "full" | "step";

export function explainStyle(kind: ExplainKind): ExplainStyle {
  return kind === "function" || kind === "class" || kind === "module"
    ? "full"
    : "step";
}

export const STEP_SENTENCE_LIMIT = 2; // VID-28
export const TITLE_MAX_WORDS = 6; // VID-14

export interface ExplainRequest {
  /** Identidade no cache (AD-015): `<languageId>|<nodeId>` num trecho, `<raiz POSIX>|<nodeId>` num projeto. */
  nodeId: NodeId;
  /** Id do plugin da linguagem do código (`python`); escolhe o prompt. */
  language: string;
  nodeName: string;
  nodeKind: ExplainKind;
  /** The node's code with its docstring masked: the same number of lines, the docstring lines blank (the first reads `<comment prefix> docstring omitida`). */
  code: string;
  /** The docstring text, apart from `code`; `line` is its first line inside `code` (1-based). The summary never comes from it. */
  docstring?: { text: string; line: number };
  range: LineRange;
  calls: string[];
  calledBy: string[];
}

/** The answer to one part; `not-cached` answers a cache-only request without a hit (CFG-05). */
export type ExplainResponse<T> =
  | {
      status: "ok";
      result: T;
      fromCache: boolean;
      review: ReviewStatus;
      update?: UpdateReason[];
    }
  | { status: "not-cached" }
  | { status: "unfaithful" }
  | { status: "no-key" }
  | { status: "error"; message: string };

export type SummaryResponse = ExplainResponse<Summary>;
export type SuggestionsResponse = ExplainResponse<Suggestion[]>;

/** Um nó a titular, montado pelo servidor a partir do próprio grafo (AD-007, AD-015). */
export interface TitleItem {
  /** ID do nó no grafo; volta na resposta. */
  nodeId: NodeId;
  /** Identidade no cache: `<languageId>|<nodeId>` num trecho, `<raiz POSIX>|<nodeId>` num projeto. */
  cacheKey: string;
  /** Id do plugin da linguagem do código; escolhe o prompt. */
  language: string;
  kind: ExplainKind;
  /** FlowNode.label */
  name: string;
  /** Linhas exatas do nó. */
  code: string;
  range: LineRange;
  calls: string[];
  calledBy: string[];
}

export interface TitleRequest {
  items: TitleItem[];
}

/** Um título revisado. Segue o contrato Claim da AD-008, com o nodeId no lugar do id. */
export interface NodeTitle {
  nodeId: NodeId;
  text: string;
  /** Absolutas, evidência do revisor. */
  lines: number[];
  fromCache: boolean;
}

/** `titles` traz só os nós com título revisado; um nó ausente fica com o nome provisório. */
export type TitlesResponse =
  | { status: "ok"; titles: NodeTitle[] }
  /** Só os acertos de cache. */
  | { status: "no-key"; titles: NodeTitle[] }
  /** Só os acertos de cache. */
  | { status: "error"; message: string; titles: NodeTitle[] };

export interface ExternalEffect {
  callee: string;
  category: ExternalCategory;
  line: number;
}
