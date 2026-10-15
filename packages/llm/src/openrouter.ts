import { createChatClient } from "./chat";
import type { LlmProvider } from "./provider";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/** OpenRouter; baseURL also serves an OpenAI-compatible fake in E2E. */
export const openrouter: LlmProvider = {
  id: "openrouter",
  defaultModel: "~deepseek/deepseek-v4-flash-latest",
  usesKey: true,
  env: { apiKey: "OPENROUTER_API_KEY", baseURL: "OPENROUTER_BASE_URL" },
  isConfigured: (config) => config.apiKey !== undefined,
  create: (config, options = {}) =>
    createChatClient({
      apiKey: config.apiKey ?? "",
      baseURL: config.baseURL ?? DEFAULT_BASE_URL,
      fetch: options.fetch,
      // OpenRouter extensions, not in the SDK types.
      extras: ({ reasoning, routing }) => ({
        ...(reasoning === "off" ? { reasoning: { enabled: false } } : {}),
        ...(routing
          ? {
              provider: {
                order: routing.order,
                allow_fallbacks: routing.allowFallbacks,
              },
            }
          : {}),
      }),
    }),
};
