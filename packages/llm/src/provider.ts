import type { LlmClient } from "@8n8/model";

/** Everything a provider needs to build a client; `resolveLlmConfig` fills it from the environment. */
export interface LlmConfig {
  /** Id of the provider (`LlmProvider.id`). */
  provider: string;
  apiKey: string | undefined;
  /** Undefined means the provider's own default URL. */
  baseURL: string | undefined;
  model: string;
  reviewModel: string;
}

/** One file per provider implements this contract; the registry in `providers.ts` lists them. */
export interface LlmProvider {
  id: string;
  /** Model used when APP8N8_MODEL is unset or empty. */
  defaultModel: string;
  /** Environment variables that hold the key and the base URL of this provider. */
  env: { apiKey: string; baseURL: string };
  /** False when the config lacks what the provider needs; the pipeline then answers no-key. */
  isConfigured(config: LlmConfig): boolean;
  /** `options.fetch` serves tests. */
  create(
    config: LlmConfig,
    options?: { fetch?: typeof globalThis.fetch | undefined },
  ): LlmClient;
}
