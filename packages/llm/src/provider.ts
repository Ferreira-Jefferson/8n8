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

/** What the host gives a provider besides the config: its environment, and a fetch for tests. */
export interface ProviderOptions {
  fetch?: typeof globalThis.fetch | undefined;
  /** The host's environment (CoreOptions.env); a provider that runs a program finds it here. */
  env?: Record<string, string | undefined> | undefined;
}

/** One file per provider implements this contract; the registry in `providers.ts` lists them. */
export interface LlmProvider {
  id: string;
  /** Model used when APP8N8_MODEL is unset or empty. */
  defaultModel: string;
  /** False for a provider with no key and no URL (Claude Code): the settings dialog hides both fields. */
  usesKey: boolean;
  /** Environment variables that hold the key and the base URL of this provider, when it has them. */
  env: { apiKey?: string; baseURL?: string };
  /** False when the config lacks what the provider needs; the pipeline then answers no-key. */
  isConfigured(config: LlmConfig, options?: ProviderOptions): boolean;
  create(config: LlmConfig, options?: ProviderOptions): LlmClient;
}
