import { createChatClient } from "./chat";
import type { LlmProvider } from "./provider";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** Any API that speaks the OpenAI chat protocol: OpenAI, Ollama, LM Studio. A local server needs only baseURL; the key is optional. */
export const openaiCompatible: LlmProvider = {
  id: "openai-compatible",
  defaultModel: "gpt-4o-mini",
  env: { apiKey: "APP8N8_LLM_API_KEY", baseURL: "APP8N8_LLM_BASE_URL" },
  isConfigured: (config) =>
    config.apiKey !== undefined || config.baseURL !== undefined,
  create: (config, options = {}) =>
    createChatClient({
      // The SDK refuses an empty key; a local server ignores this one.
      apiKey: config.apiKey ?? "not-needed",
      baseURL: config.baseURL ?? DEFAULT_BASE_URL,
      fetch: options.fetch,
    }),
};
