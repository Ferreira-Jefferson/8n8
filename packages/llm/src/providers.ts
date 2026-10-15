import type { LlmClient } from "@8n8/model";
import { anthropic } from "./anthropic";
import { claudeCode } from "./claude-code";
import { openai } from "./openai";
import { openaiCompatible } from "./openai-compatible";
import { openrouter } from "./openrouter";
import type { LlmConfig, LlmProvider, ProviderOptions } from "./provider";

/** The registry: a new provider is one file plus one entry here. */
export const PROVIDERS: LlmProvider[] = [
  openrouter,
  openai,
  anthropic,
  openaiCompatible,
  claudeCode,
];

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
  options?: ProviderOptions,
): LlmClient | undefined {
  const provider = providerOf(config.provider);
  return provider.isConfigured(config, options)
    ? provider.create(config, options)
    : undefined;
}
