import type { ClaudeLocation, LlmConfig } from "@8n8/llm";
import type { LlmClient, StoredSettings } from "@8n8/model";
import { createSettingsService, type LlmSetup } from "../settings";

/** A machine with no Claude Code: tests do not depend on the one they run on (CC-15). */
export const NO_CLAUDE = (): ClaudeLocation => ({
  path: undefined,
  source: undefined,
  envInvalid: false,
});

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
    NO_CLAUDE,
  );
  return () => service.llm();
}
