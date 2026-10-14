import type { LlmClient } from "@code2n8n/model";
import { openaiCompatible } from "./openai-compatible";
import { openrouter } from "./openrouter";
import type { LlmConfig, LlmProvider } from "./provider";

/** The registry: a new provider is one file plus one entry here. */
export const PROVIDERS: LlmProvider[] = [openrouter, openaiCompatible];

export const DEFAULT_PROVIDER = openrouter.id;

export function providerOf(id: string): LlmProvider {
  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider) {
    throw new Error(
      `Provedor de LLM desconhecido: "${id}". Use um destes: ${PROVIDERS.map((p) => p.id).join(", ")}.`,
    );
  }
  return provider;
}

/** The client for the configured provider; undefined when the config is incomplete (CORE-19). */
export function createLlmClient(
  config: LlmConfig,
  options?: { fetch?: typeof globalThis.fetch | undefined },
): LlmClient | undefined {
  const provider = providerOf(config.provider);
  return provider.isConfigured(config)
    ? provider.create(config, options)
    : undefined;
}
