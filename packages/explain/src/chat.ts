import {
  CHAT_MAX_CHARS,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type ChatSuggestion,
  DEFAULT_LOCALE,
  type LlmClient,
  type Locale,
  messageOf,
  type StructureRequest,
  type StructureResponse,
} from "@8n8/model";
import { chatContextText } from "./chat-prompt";
import { acceptSuggestion } from "./chat-suggestion";
import { jsonOf } from "./schema";

export interface ChatDeps {
  /** Absent when no LLM provider is configured. */
  llm?: LlmClient | undefined;
  model: string;
  prompt: { text: string; version: string };
  locale?: Locale;
}

/** The prompt asks for CHAT_MAX_CHARS; a little over is kept, a lot over is cut at a word, so no answer weighs on the reader. */
export function clampReply(text: string): string {
  const reply = text.trim();
  if (reply.length <= CHAT_MAX_CHARS * 1.25) return reply;
  const cut = reply.slice(0, CHAT_MAX_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The reply and the suggestion of the model's JSON; an answer that is not JSON is the reply as it is, with no suggestion. */
function readAnswer(
  raw: string,
  range: ChatRequest["range"],
): { reply: string; suggestion?: ChatSuggestion } {
  let json: unknown;
  try {
    json = jsonOf(raw);
  } catch {
    return { reply: clampReply(raw) };
  }
  const obj = (json ?? {}) as { reply?: unknown; suggestion?: unknown };
  const reply = typeof obj.reply === "string" ? obj.reply : raw;
  const suggestion = acceptSuggestion(obj.suggestion, range);
  return { reply: clampReply(reply), ...(suggestion ? { suggestion } : {}) };
}

/** One question about a node and its parent: no cache, no review; the past of the conversation comes from the screen. */
export async function chatNode(
  req: ChatRequest,
  deps: ChatDeps,
): Promise<ChatResponse> {
  if (!deps.llm) return { status: "no-key" };
  const locale = deps.locale ?? DEFAULT_LOCALE;
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${deps.prompt.text}\n\n${chatContextText(req, locale)}`,
    },
    ...req.history,
    { role: "user", content: req.question },
  ];
  try {
    const raw = await deps.llm.complete({
      model: deps.model,
      messages,
      json: "prompt",
    });
    return { status: "ok", ...readAnswer(raw, req.range) };
  } catch (err) {
    return { status: "error", message: messageOf(err, locale) };
  }
}

/** The text of an answer shaped into a suggestion; `none` when it holds no concrete improvement. */
export async function structureText(
  req: StructureRequest,
  deps: ChatDeps,
): Promise<StructureResponse> {
  if (!deps.llm) return { status: "no-key" };
  const locale = deps.locale ?? DEFAULT_LOCALE;
  try {
    const raw = await deps.llm.complete({
      model: deps.model,
      messages: [
        {
          role: "system",
          content: `${deps.prompt.text}\n\n${chatContextText(req, locale)}`,
        },
        { role: "user", content: req.text },
      ],
      json: "prompt",
    });
    let json: unknown;
    try {
      json = jsonOf(raw);
    } catch {
      return { status: "none" };
    }
    const suggestion = acceptSuggestion(
      (json as { suggestion?: unknown } | null)?.suggestion,
      req.range,
    );
    return suggestion ? { status: "ok", suggestion } : { status: "none" };
  } catch (err) {
    return { status: "error", message: messageOf(err, locale) };
  }
}
