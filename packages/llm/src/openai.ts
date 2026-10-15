import { createChatClient } from "./chat";
import type { LlmProvider } from "./provider";

const BASE_URL = "https://api.openai.com/v1";

/** The OpenAI API at its official address; a server of your own is `openai-compatible`. */
export const openai: LlmProvider = {
  id: "openai",
  defaultModel: "gpt-5-nano",
  usesKey: true,
  env: { apiKey: "OPENAI_API_KEY" },
  isConfigured: (config) => config.apiKey !== undefined,
  create: (config, options = {}) =>
    createChatClient({
      apiKey: config.apiKey ?? "",
      baseURL: BASE_URL,
      fetch: options.fetch,
    }),
};
