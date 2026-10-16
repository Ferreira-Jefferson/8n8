import {
  type ClaudeLocation,
  createLlmClient,
  DEFAULT_PROVIDER,
  isClaudeName,
  type LlmConfig,
  PROVIDERS,
  providerOf,
  resolveLlmConfig,
  whereIsClaude,
} from "@8n8/llm";
import {
  DEFAULT_LOCALE,
  type LlmClient,
  LOCALES,
  type Locale,
  LocalizedError,
  type SettingsField,
  type SettingsPatch,
  type SettingsResponse,
  type StoredSettings,
  THEMES,
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
  /** Whether dependency folders such as node_modules stay out of the map; on by default. */
  ignoreDependencies(): Promise<boolean>;
  /** The language of the system: what the LLM writes and which cache it reads. */
  locale(): Promise<Locale>;
  /** Stores the Claude Code executable the person picked, or erases it with null; throws InvalidSettings unless it is a file named claude (CC-18). */
  setClaudePath(path: string | null): Promise<SettingsResponse>;
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

// Strict: an unknown field is an error, never ignored (CFG-14).
const patchSchema = z
  .object({
    provider: z
      .string()
      .refine((id) => PROVIDERS.some((p) => p.id === id))
      .optional(),
    apiKey: z.string().trim().min(1).max(512).nullable().optional(),
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
    ignoreDependencies: z.boolean().optional(),
    theme: z.enum(THEMES).optional(),
    locale: z.enum(LOCALES).optional(),
  })
  .strict();

/** The stored settings after a patch: `null` erases; a new provider erases the key and the model, unless the patch brings them (CFG-15). */
export function applyPatch(
  stored: StoredSettings,
  patch: SettingsPatch,
): StoredSettings {
  const next: StoredSettings = { ...stored };
  const providerChanged =
    patch.provider !== undefined &&
    patch.provider !== (stored.provider ?? DEFAULT_PROVIDER);
  if (providerChanged) {
    delete next.apiKey;
    delete next.model;
  }
  for (const field of ["provider", "apiKey", "model"] as const) {
    const value = patch[field];
    if (value === null) delete next[field];
    else if (value !== undefined) next[field] = value;
  }
  if (patch.autoSummary !== undefined) next.autoSummary = patch.autoSummary;
  if (patch.autoSuggestions !== undefined) {
    next.autoSuggestions = patch.autoSuggestions;
  }
  if (patch.ignoreDependencies !== undefined) {
    next.ignoreDependencies = patch.ignoreDependencies;
  }
  if (patch.theme !== undefined) next.theme = patch.theme;
  if (patch.locale !== undefined) next.locale = patch.locale;
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
  // Where Claude Code is; tests pass a fake file system (CC-15, CC-17).
  locate: (env: Env, picked?: string) => ClaudeLocation = whereIsClaude,
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

  /** claude-code is the default when Claude Code is found, openrouter otherwise (CC-15). */
  const configOf = (s: StoredSettings) => {
    const claude = locate(env, s.claudePath);
    const fallback = claude.path ? "claude-code" : DEFAULT_PROVIDER;
    return { config: resolveLlmConfig(env, s, fallback), claude };
  };

  const write = async (change: (s: StoredSettings) => StoredSettings) => {
    const run = writes.then(async () => {
      const next = change(await load());
      await store.write(next);
      stored = Promise.resolve(next);
    });
    writes = run.catch(() => {});
    await run;
  };

  const view = async (): Promise<SettingsResponse> => {
    const s = await load();
    const { config, claude } = configOf(s);
    const provider = providerOf(config.provider);
    // A provider without a key has no variable for it.
    const names: Record<SettingsField, string | undefined> = {
      provider: "APP8N8_LLM_PROVIDER",
      apiKey: provider.env.apiKey,
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
      model: config.model,
      autoSummary: modes.summary,
      autoSuggestions: modes.suggestions,
      ignoreDependencies: s.ignoreDependencies ?? true,
      theme: s.theme ?? "system",
      locale: s.locale ?? DEFAULT_LOCALE,
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
      claude: {
        path: claude.path ?? null,
        source: claude.source ?? null,
        envInvalid: claude.envInvalid,
      },
    };
  };

  return {
    view,
    async update(raw) {
      const parsed = patchSchema.safeParse(raw);
      if (!parsed.success) throw new InvalidSettings("invalid settings");
      await write((s) => {
        const patch = { ...(parsed.data as SettingsPatch) };
        // A key or model saved under the automatic default is pinned to that provider:
        // with no provider stored, it would read as openrouter's (CC-15).
        const pin =
          patch.provider === undefined &&
          s.provider === undefined &&
          !env.APP8N8_LLM_PROVIDER &&
          (patch.apiKey != null || patch.model != null);
        const current = configOf(s).config.provider;
        if (pin && current !== DEFAULT_PROVIDER) patch.provider = current;
        return applyPatch(s, patch);
      });
      return view();
    },
    async setClaudePath(path) {
      if (
        path !== null &&
        (!isClaudeName(path) || locate({}, path).source !== "picked")
      ) {
        throw new InvalidSettings("not claude");
      }
      await write((s) => {
        const next = { ...s };
        if (path === null) delete next.claudePath;
        else next.claudePath = path;
        return next;
      });
      return view();
    },
    async llm() {
      const { config } = configOf(await load());
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
    async ignoreDependencies() {
      return (await load()).ignoreDependencies ?? true;
    },
    async locale() {
      return (await load()).locale ?? DEFAULT_LOCALE;
    },
  };
}

const KEY_MASK = "[***]";

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
        // A keyed error carries no provider text: it passes as it is, to be said in the language of the system.
        if (err instanceof LocalizedError) throw err;
        throw new Error(
          scrub(err instanceof Error ? err.message : String(err)),
        );
      }
    },
  };
}
