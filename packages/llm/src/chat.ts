import type { LlmClient } from "@code2n8n/model";
import OpenAI from "openai";
import { type ModelProfile, profileOf } from "./profiles";

const TIMEOUT_MS = 60_000;

/** One request, no retries (CORE-16, CORE-21), over the openai SDK; `extras` adds provider-specific body fields from the model profile. */
export function createChatClient(options: {
  apiKey: string;
  baseURL: string;
  fetch?: typeof globalThis.fetch | undefined;
  extras?: (profile: ModelProfile) => Record<string, unknown>;
}): LlmClient {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    timeout: TIMEOUT_MS,
    maxRetries: 0,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    async complete({ model, messages, json }) {
      const profile = profileOf(model);
      const body = {
        model,
        messages,
        // "native" is what the pipeline asks for; the profile decides whether the model takes it.
        ...(json === "native" && profile.json === "native"
          ? { response_format: { type: "json_object" as const } }
          : {}),
        ...options.extras?.(profile),
      };
      const response = await client.chat.completions.create(body);
      return response.choices[0]?.message?.content ?? "";
    },
  };
}
