import {
  createLlmClient,
  DEFAULT_PROVIDER,
  type LlmConfig,
  PROVIDERS,
  providerOf,
  resolveLlmConfig,
} from "@8n8/llm";
import type {
  LlmClient,
  SettingsField,
  SettingsPatch,
  SettingsResponse,
  StoredSettings,
} from "@8n8/model";
import { z } from "zod";

/** Where a host keeps the settings between runs: a file in the CLI, the editor's storage in an extension (CFG-18). */
export interface SettingsStore {
  read(): Promise<StoredSettings>;
  write(settings: StoredSettings): Promise<void>;
}

/** The LLM client of the current settings and the config it came from; no client when the provider lacks its key or URL (CORE-19). */
export interface LlmSetup {
  client: LlmClient | undefined;
  config: LlmConfig;
}

export interface SettingsService {
  /** The effective settings, never the key (CFG-12). */
  view(): Promise<SettingsResponse>;
  /** Validates, applies and stores a patch; throws InvalidSettings and stores nothing on a bad one (CFG-13, CFG-14, CFG-15). */
  update(patch: unknown): Promise<SettingsResponse>;
  /** The client of the current settings; a new one only after the settings change (CFG-17). */
  llm(): Promise<LlmSetup>;
  /** The automatic modes in effect (CFG-08). */
  auto(): Promise<{ summary: boolean; suggestions: boolean }>;
}

export class InvalidSettings extends Error {}

type Env = Record<string, string | undefined>;

const AUTO_ENV = {
  autoSummary: "APP8N8_AUTO_SUMMARY",
  autoSuggestions: "APP8N8_AUTO_SUGGESTIONS",
} as const;

/** `1`/`true` and `0`/`false`; anything else counts as unset. */
function flag(value: string | undefined): boolean | undefined {
  const v = value?.trim().toLowerCase();
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return undefined;
}

const isHttpUrl = (value: string) => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

// Strict: an unknown field is an error, never ignored (CFG-14).
const patchSchema = z
  .object({
    provider: z
      .string()
      .refine((id) => PROVIDERS.some((p) => p.id === id))
      .optional(),
    apiKey: z.string().trim().min(1).max(512).nullable().optional(),
    baseURL: z.string().max(2048).refine(isHttpUrl).nullable().optional(),
    // A model id, never something a program could read as a flag (CC-03): it may start
    // with a letter, a digit or `~` (OpenRouter), then only id characters.
    model: z
      .string()
      .trim()
      .max(256)
      .regex(/^[A-Za-z0-9~][\w.:/~@+[\]-]*$/)
      .nullable()
      .optional(),
    autoSummary: z.boolean().optional(),
    autoSuggestions: z.boolean().optional(),
  })
  .strict();

/** The stored settings after a patch: `null` erases; a new provider or URL erases the key, and a new provider its URL and model, unless the patch brings them (CFG-15). */
export function applyPatch(
  stored: StoredSettings,
  patch: SettingsPatch,
): StoredSettings {
  const next: StoredSettings = { ...stored };
  const providerChanged =
    patch.provider !== undefined &&
    patch.provider !== (stored.provider ?? DEFAULT_PROVIDER);
  const urlChanged =
    patch.baseURL !== undefined &&
    (patch.baseURL ?? undefined) !== stored.baseURL;
  if (providerChanged) {
    delete next.baseURL;
    delete next.model;
  }
  if (providerChanged || urlChanged) delete next.apiKey;
  for (const field of ["provider", "apiKey", "baseURL", "model"] as const) {
    const value = patch[field];
    if (value === null) delete next[field];
    else if (value !== undefined) next[field] = value;
  }
  if (patch.autoSummary !== undefined) next.autoSummary = patch.autoSummary;
  if (patch.autoSuggestions !== undefined) {
    next.autoSuggestions = patch.autoSuggestions;
  }
  return next;
}

/**
 * The settings of one core: the environment, the host's store and the LLM
 * client built from both. The store is read once; every update goes through
 * here, one at a time.
 */
export function createSettingsService(
  env: Env,
  store: SettingsStore,
  // The host's environment reaches the providers: Claude Code finds its executable there (CC-02).
  createClient: (config: LlmConfig) => LlmClient | undefined = (config) =>
    createLlmClient(config, { env }),
): SettingsService {
  let stored: Promise<StoredSettings> | undefined;
  const load = () => {
    stored ??= store.read().catch(() => ({}));
    return stored;
  };
  let writes: Promise<unknown> = Promise.resolve();
  let built: { key: string; setup: LlmSetup } | undefined;

  const auto = (s: StoredSettings) => ({
    summary: flag(env[AUTO_ENV.autoSummary]) ?? s.autoSummary ?? false,
    suggestions:
      flag(env[AUTO_ENV.autoSuggestions]) ?? s.autoSuggestions ?? false,
  });

  const view = async (): Promise<SettingsResponse> => {
    const s = await load();
    const config = resolveLlmConfig(env, s);
    const provider = providerOf(config.provider);
    // A provider without a key or a URL has no variable for them.
    const names: Record<SettingsField, string | undefined> = {
      provider: "APP8N8_LLM_PROVIDER",
      apiKey: provider.env.apiKey,
      baseURL: provider.env.baseURL,
      model: "APP8N8_MODEL",
      ...AUTO_ENV,
    };
    const setBy = (field: SettingsField) => {
      const name = names[field];
      if (name === undefined) return false;
      return field === "autoSummary" || field === "autoSuggestions"
        ? flag(env[name]) !== undefined
        : Boolean(env[name]);
    };
    const modes = auto(s);
    return {
      provider: config.provider,
      ...(config.baseURL === undefined ? {} : { baseURL: config.baseURL }),
      model: config.model,
      autoSummary: modes.summary,
      autoSuggestions: modes.suggestions,
      hasKey: config.apiKey !== undefined,
      providers: PROVIDERS.map(({ id, defaultModel, usesKey }) => ({
        id,
        defaultModel,
        usesKey,
      })),
      env: Object.fromEntries(
        (Object.keys(names) as SettingsField[])
          .filter(setBy)
          .map((field) => [field, names[field]]),
      ),
    };
  };

  return {
    view,
    async update(raw) {
      const parsed = patchSchema.safeParse(raw);
      if (!parsed.success) throw new InvalidSettings("invalid settings");
      const run = writes.then(async () => {
        const next = applyPatch(await load(), parsed.data as SettingsPatch);
        await store.write(next);
        stored = Promise.resolve(next);
      });
      writes = run.catch(() => {});
      await run;
      return view();
    },
    async llm() {
      const config = resolveLlmConfig(env, await load());
      const key = JSON.stringify(config);
      if (built?.key !== key) {
        built = {
          key,
          setup: {
            client: withoutKey(createClient(config), config.apiKey),
            config,
          },
        };
      }
      return built.setup;
    },
    async auto() {
      return auto(await load());
    },
  };
}

const KEY_MASK = "[chave omitida]";

/**
 * A provider's error message can echo the key: OpenAI shows it masked, a hostile URL
 * in full. The message reaches the browser, so the key and any word that starts like it
 * are cut first (DIST-17).
 */
function withoutKey(
  client: LlmClient | undefined,
  key: string | undefined,
): LlmClient | undefined {
  if (!client || !key) return client;
  const prefix = key.slice(0, 6).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const masked = new RegExp(`${prefix}\\S*`, "g");
  const scrub = (text: string) =>
    text.split(key).join(KEY_MASK).replace(masked, KEY_MASK);
  return {
    async complete(req) {
      try {
        return await client.complete(req);
      } catch (err) {
        throw new Error(
          scrub(err instanceof Error ? err.message : String(err)),
        );
      }
    },
  };
}
