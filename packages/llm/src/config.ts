import type { LlmConfig } from "./provider";
import { DEFAULT_PROVIDER, providerOf } from "./providers";

type Env = Record<string, string | undefined>;

/** Empty values count as absent (CORE-21). */
const present = (value: string | undefined) => value || undefined;

/**
 * Provider from APP8N8_LLM_PROVIDER (default openrouter); key and base URL from that provider's variables;
 * model from APP8N8_MODEL (default of the provider); reviewer model from APP8N8_REVIEW_MODEL (default the summary model) (FID-15).
 * Throws on an unknown provider.
 */
export function resolveLlmConfig(env: Env): LlmConfig {
  const provider = providerOf(
    present(env.APP8N8_LLM_PROVIDER) ?? DEFAULT_PROVIDER,
  );
  const model = present(env.APP8N8_MODEL) ?? provider.defaultModel;
  return {
    provider: provider.id,
    apiKey: present(env[provider.env.apiKey]),
    baseURL: present(env[provider.env.baseURL]),
    model,
    reviewModel: present(env.APP8N8_REVIEW_MODEL) ?? model,
  };
}
