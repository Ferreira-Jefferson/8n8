import type { ExternalCategory, LineRange, NodeId } from "./graph.ts";

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

export interface Explanation {
  /** The kept sentences joined by a space. */
  summary: string;
  sentences: Claim[];
  inputs: Claim[];
  outputs: Claim[];
  suggestions: Suggestion[];
}

/** "full" = "Revisado"; "cut" = "Revisado com cortes". */
export type ReviewStatus = "full" | "cut";

export type UpdateReason = "code" | "neighbours" | "model-or-prompt";

export interface ExplainRequest {
  nodeId: NodeId;
  nodeName: string;
  nodeKind: "function" | "class";
  code: string;
  range: LineRange;
  calls: string[];
  calledBy: string[];
}

export type ExplainResponse =
  | {
      status: "ok";
      explanation: Explanation;
      fromCache: boolean;
      review: ReviewStatus;
      update?: UpdateReason[];
    }
  | { status: "unfaithful" }
  | { status: "no-key" }
  | { status: "error"; message: string };

export interface ExternalEffect {
  callee: string;
  category: ExternalCategory;
  line: number;
}
