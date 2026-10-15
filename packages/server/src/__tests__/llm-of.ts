import type { LlmConfig } from "@8n8/llm";
import type { LlmClient, StoredSettings } from "@8n8/model";
import { createSettingsService, type LlmSetup } from "../settings";

/** The core's LLM getter over an in-memory store, with a fake client factory in place of the real one. */
export function llmOf(
  env: Record<string, string | undefined>,
  createClient: (config: LlmConfig) => LlmClient | undefined,
  stored: StoredSettings = {},
): () => Promise<LlmSetup> {
  const service = createSettingsService(
    env,
    { read: async () => stored, write: async () => {} },
    createClient,
  );
  return () => service.llm();
}
