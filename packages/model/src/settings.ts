/** What a host keeps between runs; every field is optional (AD-023). */
export interface StoredSettings {
  provider?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  autoSummary?: boolean;
  autoSuggestions?: boolean;
}

/** A change from the settings dialog: only the fields that changed; `null` erases a stored value (CFG-13). */
export interface SettingsPatch {
  provider?: string;
  apiKey?: string | null;
  baseURL?: string | null;
  model?: string | null;
  autoSummary?: boolean;
  autoSuggestions?: boolean;
}

/** A field the dialog shows; `apiKey` is never sent back, only whether one exists. */
export type SettingsField =
  | "provider"
  | "apiKey"
  | "baseURL"
  | "model"
  | "autoSummary"
  | "autoSuggestions";

/** The effective settings, without the key (CFG-12). */
export interface SettingsResponse {
  provider: string;
  /** Undefined means the provider's own default URL. */
  baseURL?: string;
  model: string;
  autoSummary: boolean;
  autoSuggestions: boolean;
  /** Whether a key is in effect, from the environment or stored. */
  hasKey: boolean;
  /** `usesKey` false: the provider needs no key and no URL (Claude Code, CC-01). */
  providers: { id: string; defaultModel: string; usesKey: boolean }[];
  /** The environment variable that sets a field, for each field one sets (CFG-22). */
  env: Partial<Record<SettingsField, string>>;
}
