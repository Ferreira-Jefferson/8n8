import {
  CHAT_MAX_CHARS,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  DEFAULT_LOCALE,
  type LlmClient,
  type Locale,
  messageOf,
} from "@8n8/model";
import { chatContextText } from "./chat-prompt";

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
    const reply = await deps.llm.complete({
      model: deps.model,
      messages,
      json: "prompt",
    });
    return { status: "ok", reply: clampReply(reply) };
  } catch (err) {
    return { status: "error", message: messageOf(err, locale) };
  }
}
