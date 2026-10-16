import type { ExplainKind, Severity, Suggestion } from "./explanation.ts";
import type { LineRange } from "./graph.ts";

/** The most characters a chat answer may have: the prompt asks for it and the server cuts what passes (cost, and a short answer reads better). */
export const CHAT_MAX_CHARS = 600;

/** The turns the server accepts as the past of a conversation, and the size of each. */
export const CHAT_MAX_TURNS = 12;
export const CHAT_MAX_TURN_CHARS = 2000;
export const CHAT_MAX_QUESTION_CHARS = 1000;
export const CHAT_MAX_TEXT_CHARS = 2000;

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

/** An improvement the chat found in an answer; `line` is absolute in the file, inside the node. */
export interface ChatSuggestion {
  command: string;
  reason: string;
  line: number;
  severity: Severity;
}

export type ChatResponse =
  | { status: "ok"; reply: string; suggestion?: ChatSuggestion }
  | { status: "no-key" }
  | { status: "error"; message: string };

/** The person keeps an answer as a suggestion: the server shapes the text into one. */
export interface StructureRequest extends ChatContext {
  text: string;
}

export type StructureResponse =
  | { status: "ok"; suggestion: ChatSuggestion }
  /** The text holds no concrete improvement. */
  | { status: "none" }
  | { status: "no-key" }
  | { status: "error"; message: string };

/** What identifies a suggestion apart from its id: its text. A removed suggestion is remembered by this key. */
export function suggestionKey(s: { command: string; reason: string }): string {
  return `${s.command.trim().toLowerCase()}
${s.reason.trim().toLowerCase()}`;
}

/** What the person did with the suggestions of a node: the ones kept from the chat, and the key of each one removed. */
export interface NodeNotes {
  /** Suggestions kept from the chat, with absolute lines. */
  saved: Suggestion[];
  dismissed: string[];
}

/** The suggestions the person kept from the chat, for one node. */
export type SavedSuggestions = Suggestion[];
