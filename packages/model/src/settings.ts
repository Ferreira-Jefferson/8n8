/** The UI theme; `system` follows the system's color scheme. */
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** The language of the whole system: the screen, the server messages and what the LLM writes. Never the code's own names. */
export const LOCALES = ["pt-BR", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "pt-BR";

/** What a host keeps between runs; every field is optional (AD-023). */
export interface StoredSettings {
  provider?: string;
  apiKey?: string;
  model?: string;
  autoSummary?: boolean;
  autoSuggestions?: boolean;
  /** Skips what the .gitignore ignores and dependency folders such as node_modules when reading a folder; on unless stored as false. */
  ignoreDependencies?: boolean;
  theme?: Theme;
  locale?: Locale;
  /** The Claude Code executable picked in the system's file chooser; never set by a patch (CC-18). */
  claudePath?: string;
}

/** A change from the settings dialog: only the fields that changed; `null` erases a stored value (CFG-13). */
export interface SettingsPatch {
  provider?: string;
  apiKey?: string | null;
  model?: string | null;
  autoSummary?: boolean;
  autoSuggestions?: boolean;
  ignoreDependencies?: boolean;
  theme?: Theme;
  locale?: Locale;
}

/** A field the dialog shows; `apiKey` is never sent back, only whether one exists. */
export type SettingsField =
  | "provider"
  | "apiKey"
  | "model"
  | "autoSummary"
  | "autoSuggestions";

/** The effective settings, without the key (CFG-12). */
export interface SettingsResponse {
  provider: string;
  model: string;
  autoSummary: boolean;
  autoSuggestions: boolean;
  ignoreDependencies: boolean;
  theme: Theme;
  locale: Locale;
  /** Whether a key is in effect, from the environment or stored. */
  hasKey: boolean;
  /** `usesKey` false: the provider needs no key (Claude Code, CC-01). */
  providers: { id: string; defaultModel: string; usesKey: boolean }[];
  /** The environment variable that sets a field, for each field one sets (CFG-22). */
  env: Partial<Record<SettingsField, string>>;
  /** Where Claude Code is on this machine (CC-17): the path in use, or null when none is found. */
  claude: {
    path: string | null;
    /** The variable, the file picked in the dialog, or the known install places. */
    source: "env" | "picked" | "auto" | null;
    /** APP8N8_CLAUDE_PATH is set but names no file. */
    envInvalid: boolean;
  };
}
