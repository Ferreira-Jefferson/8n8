import OpenAI from "openai";

export interface ChatMessage {
  role: "system" | "user";
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

/** OpenRouter client over the openai SDK: one request, no retries (CORE-16, CORE-21). */
export function createOpenRouterClient(
  apiKey: string,
  options: { fetch?: typeof globalThis.fetch } = {},
): LlmClient {
  const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
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
        // OpenRouter extension, not in the SDK types. DeepSeek reasons by default; off cuts latency.
        ...(/^~?deepseek\//.test(model)
          ? { reasoning: { enabled: false } }
          : {}),
      };
      const response = await client.chat.completions.create(body);
      return response.choices[0]?.message?.content ?? "";
    },
  };
}
