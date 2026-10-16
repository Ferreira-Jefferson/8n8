import type { ExplainKind } from "./explanation.ts";
import type { LineRange } from "./graph.ts";

/** The most characters a chat answer may have: the prompt asks for it and the server cuts what passes (cost, and a short answer reads better). */
export const CHAT_MAX_CHARS = 600;

/** The turns the server accepts as the past of a conversation, and the size of each. */
export const CHAT_MAX_TURNS = 12;
export const CHAT_MAX_TURN_CHARS = 2000;
export const CHAT_MAX_QUESTION_CHARS = 1000;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** The node and its parent: all the chat knows about the code. The server builds it from its own graph. */
export interface ChatContext {
  language: string;
  nodeName: string;
  nodeKind: ExplainKind;
  /** The node's code; line `range.start` is the first. */
  code: string;
  range: LineRange;
  /** The whole parent (the function of an `if`, the file of a function), when it has one. */
  parent?: {
    name: string;
    kind: ExplainKind;
    code: string;
    range: LineRange;
  };
  calls: string[];
  calledBy: string[];
}

export interface ChatRequest extends ChatContext {
  history: ChatTurn[];
  question: string;
}

export type ChatResponse =
  | { status: "ok"; reply: string }
  | { status: "no-key" }
  | { status: "error"; message: string };
