import type { LineRange } from "./graph.ts";

export type Severity = "alta" | "media" | "baixa";

export interface Suggestion {
  command: string;
  reason: string;
  line: number;
  severity: Severity;
}

export interface Explanation {
  summary: string;
  inputs: string[];
  outputs: string[];
  suggestions: Suggestion[];
}

export interface ExplainRequest {
  nodeName: string;
  nodeKind: "function" | "class";
  code: string;
  range: LineRange;
  calls: string[];
  calledBy: string[];
}

export type ExplainResponse =
  | { status: "ok"; explanation: Explanation; fromCache: boolean }
  | { status: "no-key" }
  | { status: "error"; message: string };
