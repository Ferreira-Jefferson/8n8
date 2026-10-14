import OpenAI from "openai";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmClient {
  complete(req: {
    model: string;
    messages: ChatMessage[];
    json: "native" | "prompt";
  }): Promise<string>;
}

const TIMEOUT_MS = 60_000;
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/** OpenRouter client over the openai SDK: one request, no retries (CORE-16, CORE-21); baseURL serves an OpenAI-compatible fake in E2E. */
export function createOpenRouterClient(
  apiKey: string,
  options: {
    fetch?: typeof globalThis.fetch;
    baseURL?: string | undefined;
  } = {},
): LlmClient {
  const client = new OpenAI({
    apiKey,
    baseURL: options.baseURL ?? DEFAULT_BASE_URL,
    timeout: TIMEOUT_MS,
    maxRetries: 0,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    async complete({ model, messages, json }) {
      const body = {
        model,
        messages,
        ...(json === "native"
          ? { response_format: { type: "json_object" as const } }
          : {}),
        // OpenRouter extensions, not in the SDK types. DeepSeek reasons by default; off cuts latency.
        // Default routing favours price and lands on providers that take 11–20 s; these answered in ~2 s with the least spread (2026-10-14).
        ...(/^~?deepseek\//.test(model)
          ? {
              reasoning: { enabled: false },
              provider: {
                order: ["baidu/fp8", "wafer/fast", "atlas-cloud/fp4"],
                allow_fallbacks: true,
              },
            }
          : {}),
      };
      const response = await client.chat.completions.create(body);
      return response.choices[0]?.message?.content ?? "";
    },
  };
}
