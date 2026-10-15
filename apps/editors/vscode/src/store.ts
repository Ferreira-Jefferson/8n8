import type { SettingsStore } from "@8n8/server";

type Stored = Awaited<ReturnType<SettingsStore["read"]>>;

/** The part of vscode.SecretStorage the store uses. */
export interface SecretsLike {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

/** The part of vscode.Memento (globalState) the store uses. */
export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export const SECRET_KEY = "8n8.apiKey";
export const STATE_KEY = "8n8.settings";

const TEXT_FIELDS = ["provider", "model"] as const;
const FLAG_FIELDS = ["autoSummary", "autoSuggestions"] as const;
const THEMES = ["system", "light", "dark"] as const;

/** Only the known fields of the right type: a stray value in the state is dropped. */
function known(value: unknown): Stored {
  if (typeof value !== "object" || value === null) return {};
  const raw = value as Record<string, unknown>;
  const out: Stored = {};
  for (const field of TEXT_FIELDS) {
    const v = raw[field];
    if (typeof v === "string") out[field] = v;
  }
  for (const field of FLAG_FIELDS) {
    const v = raw[field];
    if (typeof v === "boolean") out[field] = v;
  }
  const theme = THEMES.find((t) => t === raw.theme);
  if (theme) out.theme = theme;
  return out;
}

/**
 * The settings of the extension: the key in VS Code's SecretStorage (the
 * system's credential store), the rest in globalState. The key never goes to
 * globalState (AD-023, VSC-05).
 */
export function createVscodeSettingsStore(
  secrets: SecretsLike,
  state: MementoLike,
): SettingsStore {
  return {
    async read() {
      const apiKey = await secrets.get(SECRET_KEY);
      return { ...known(state.get(STATE_KEY)), ...(apiKey ? { apiKey } : {}) };
    },
    async write(settings) {
      const { apiKey, ...rest } = settings;
      await state.update(STATE_KEY, known(rest));
      if (apiKey) await secrets.store(SECRET_KEY, apiKey);
      else await secrets.delete(SECRET_KEY);
    },
  };
}
