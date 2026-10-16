import type { StoredSettings } from "@8n8/model";
import type { LlmConfig } from "./provider";
import { DEFAULT_PROVIDER, PROVIDERS, providerOf } from "./providers";

type Env = Record<string, string | undefined>;

/** Empty values count as absent (CORE-21). */
const present = (value: string | undefined) => value || undefined;

/** The value of a provider variable; a provider without that variable reads nothing. */
const fromEnv = (env: Env, name: string | undefined) =>
  name === undefined ? undefined : present(env[name]);

/** A stored provider no registry entry knows (a hand-edited file) counts as absent. */
const knownProvider = (id: string | undefined) =>
  PROVIDERS.some((p) => p.id === id) ? id : undefined;

/**
 * Field by field, the environment wins over the stored settings, and the stored
 * settings win over the defaults (CFG-16):
 * - provider: APP8N8_LLM_PROVIDER, then the stored one, then `defaultProvider`
 *   (claude-code when the host finds Claude Code, CC-15; else openrouter);
 * - key: that provider's variable, then the stored one; base URL: that provider's variable only;
 * - model: APP8N8_MODEL, then the stored one, then the provider's default;
 * - reviewer model: APP8N8_REVIEW_MODEL, then the summary model (FID-15).
 * The stored key and model belong to the stored provider: they never go
 * to another one. Throws on an unknown provider in the environment.
 */
export function resolveLlmConfig(
  env: Env,
  stored: StoredSettings = {},
  defaultProvider: string = DEFAULT_PROVIDER,
): LlmConfig {
  // A key or model stored with no provider dates from when openrouter was the only default.
  const fallback =
    stored.apiKey !== undefined || stored.model !== undefined
      ? DEFAULT_PROVIDER
      : defaultProvider;
  const provider = providerOf(
    present(env.APP8N8_LLM_PROVIDER) ??
      knownProvider(stored.provider) ??
      fallback,
  );
  // The fields belong to the provider they were stored with, unknown ones included.
  const owner = stored.provider ?? DEFAULT_PROVIDER;
  const own: StoredSettings = owner === provider.id ? stored : {};
  const model =
    present(env.APP8N8_MODEL) ?? present(own.model) ?? provider.defaultModel;
  return {
    provider: provider.id,
    apiKey: fromEnv(env, provider.env.apiKey) ?? present(own.apiKey),
    baseURL: fromEnv(env, provider.env.baseURL),
    model,
    reviewModel: present(env.APP8N8_REVIEW_MODEL) ?? model,
    claudePath: present(stored.claudePath),
  };
}
