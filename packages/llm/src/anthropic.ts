import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider } from "./provider";

const TIMEOUT_MS = 60_000;
/** The Messages API requires a cap; summaries and suggestions are short. */
const MAX_TOKENS = 4096;

/** The Anthropic API with a key, over the official SDK. Claude Code, which needs no key, is `claude-code`. */
export const anthropic: LlmProvider = {
  id: "anthropic",
  defaultModel: "claude-haiku-5-5",
  usesKey: true,
  env: { apiKey: "ANTHROPIC_API_KEY" },
  isConfigured: (config) => config.apiKey !== undefined,
  create: (config, options = {}) => {
    const client = new Anthropic({
      apiKey: config.apiKey ?? "",
      timeout: TIMEOUT_MS,
      maxRetries: 0,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    return {
      // No native JSON mode here: `json` is met by the prompt alone, like for a "prompt" profile.
      async complete({ model, messages }) {
        const system = messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n\n");
        const response = await client.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          ...(system ? { system } : {}),
          messages: messages.flatMap((m) =>
            m.role === "system" ? [] : [{ role: m.role, content: m.content }],
          ),
        });
        return response.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("");
      },
    };
  },
};
