import {
  LOCALES,
  type Locale,
  type SettingsField,
  type SettingsPatch,
  type SettingsResponse,
  THEMES,
  type Theme,
} from "@8n8/model";
import { useEffect, useId, useState } from "react";
import { saveSettings, setClaudePath } from "../api";
import { type MessageKey, useT } from "../i18n";

export interface SettingsDialogProps {
  /** The effective settings; null when the server could not answer. */
  settings: SettingsResponse | null;
  onSaved: (settings: SettingsResponse) => void;
  onClose: () => void;
}

/** The text fields as typed; an empty model means the provider's default. */
interface Form {
  provider: string;
  apiKey: string;
  model: string;
  autoSummary: boolean;
  autoSuggestions: boolean;
  ignoreDependencies: boolean;
}

const THEME_LABELS: Record<Theme, MessageKey> = {
  system: "settings.theme.system",
  light: "settings.theme.light",
  dark: "settings.theme.dark",
};

/** Each language in its own name, so a person finds theirs in any language. */
const LOCALE_LABELS: Record<Locale, string> = {
  "pt-BR": "Português (Brasil)",
  en: "English",
};

/** The short code on the language button. */
const LOCALE_CODES: Record<Locale, string> = { "pt-BR": "BR", en: "EN" };

/** Each click moves to the next language, back to the first after the last. */
const nextLocale = (locale: Locale): Locale =>
  LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length] ?? "pt-BR";

/** Each click moves to the next theme, back to the first after the last. */
const nextTheme = (theme: Theme): Theme =>
  THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "system";

const defaultModelOf = (settings: SettingsResponse, provider: string) =>
  settings.providers.find((p) => p.id === provider)?.defaultModel ?? "";

/** A provider with no key (Claude Code) shows no key field (CC-01). */
const usesKey = (settings: SettingsResponse, provider: string) =>
  settings.providers.find((p) => p.id === provider)?.usesKey ?? true;

function formOf(settings: SettingsResponse): Form {
  return {
    provider: settings.provider,
    apiKey: "",
    // The default model shows as the field's hint, not as a stored value.
    model:
      settings.model === defaultModelOf(settings, settings.provider)
        ? ""
        : settings.model,
    autoSummary: settings.autoSummary,
    autoSuggestions: settings.autoSuggestions,
    ignoreDependencies: settings.ignoreDependencies,
  };
}

/** Only the fields that changed; a cleared model erases the stored one (CFG-21). */
export function patchOf(before: Form, after: Form): SettingsPatch {
  const patch: SettingsPatch = {};
  if (after.provider !== before.provider) patch.provider = after.provider;
  if (after.apiKey.trim() !== "") patch.apiKey = after.apiKey.trim();
  if (after.model.trim() !== before.model) {
    patch.model = after.model.trim() || null;
  }
  if (after.autoSummary !== before.autoSummary) {
    patch.autoSummary = after.autoSummary;
  }
  if (after.autoSuggestions !== before.autoSuggestions) {
    patch.autoSuggestions = after.autoSuggestions;
  }
  if (after.ignoreDependencies !== before.ignoreDependencies) {
    patch.ignoreDependencies = after.ignoreDependencies;
  }
  return patch;
}

type Status = "idle" | "saving" | "saved" | "failed";

/** Provider, key, model and the automatic modes; a field the environment sets stays read-only (CFG-20, CFG-21, CFG-22). */
export function SettingsDialog({
  settings,
  onSaved,
  onClose,
}: SettingsDialogProps) {
  const titleId = useId();
  const t = useT();
  const [form, setForm] = useState<Form | null>(
    settings ? formOf(settings) : null,
  );
  const [status, setStatus] = useState<Status>("idle");
  const [theme, setTheme] = useState<Theme | null>(settings?.theme ?? null);
  // Showing dependency folders is the risky way: it waits for a confirmation.
  const [confirmShow, setConfirmShow] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(patch: SettingsPatch) {
    if (!settings || !form) return;
    if (Object.keys(patch).length === 0) {
      setStatus("saved");
      return;
    }
    setStatus("saving");
    const next = await saveSettings(patch);
    if (!next) {
      setStatus("failed");
      return;
    }
    onSaved(next);
    setForm(formOf(next));
    setStatus("saved");
  }

  // The theme saves on the click, apart from the form and its Salvar.
  async function switchTheme(current: Theme) {
    const next = await saveSettings({ theme: nextTheme(current) });
    if (!next) {
      setStatus("failed");
      return;
    }
    onSaved(next);
    setTheme(next.theme);
  }

  // The language saves on the choice too; the screen changes at once.
  async function switchLocale(locale: Locale) {
    const next = await saveSettings({ locale });
    if (!next) {
      setStatus("failed");
      return;
    }
    onSaved(next);
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setStatus("idle");
  };
  const pickProvider = (provider: string) => {
    // A model of one provider means nothing to another, unless a variable fixes it.
    const keep = Boolean(lockedBy("model"));
    setForm((f) => (f ? { ...f, provider, model: keep ? f.model : "" } : f));
    setStatus("idle");
  };
  const lockedBy = (field: SettingsField) => settings?.env[field];
  const lockNote = (field: SettingsField) =>
    lockedBy(field) ? (
      <small className="locked">
        {t("settings.lockedBy", { name: lockedBy(field) ?? "" })}
      </small>
    ) : null;

  return (
    <div className="dialog-backdrop">
      <div
        className="panel settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="settings-head">
          <h2 id={titleId}>{t("settings.title")}</h2>
          <div className="head-btns">
            {settings && (
              <button
                type="button"
                className="btn-ghost head-btn locale-btn"
                aria-label={t("settings.localeNow", {
                  name: LOCALE_LABELS[settings.locale],
                })}
                title={t("settings.localeNow", {
                  name: LOCALE_LABELS[settings.locale],
                })}
                onClick={() => switchLocale(nextLocale(settings.locale))}
              >
                {LOCALE_CODES[settings.locale]}
              </button>
            )}
            {theme && (
              <button
                type="button"
                className="btn-ghost head-btn"
                aria-label={t("settings.theme", {
                  name: t(THEME_LABELS[theme]),
                })}
                title={t("settings.theme", { name: t(THEME_LABELS[theme]) })}
                onClick={() => switchTheme(theme)}
              >
                <ThemeIcon theme={theme} />
              </button>
            )}
          </div>
        </div>
        {!settings || !form ? (
          <p>{t("settings.unreadable")}</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save(patchOf(formOf(settings), form));
            }}
          >
            <label>
              {t("settings.provider")}
              <select
                value={form.provider}
                disabled={Boolean(lockedBy("provider"))}
                onChange={(e) => pickProvider(e.target.value)}
              >
                {settings.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id}
                  </option>
                ))}
              </select>
            </label>
            {lockNote("provider")}
            {form.provider === "claude-code" && (
              <ClaudeState
                settings={settings}
                onChanged={(next) => {
                  onSaved(next);
                  setStatus("idle");
                }}
              />
            )}
            {usesKey(settings, form.provider) && (
              <>
                <label>
                  {t("settings.apiKey")}
                  <input
                    type="password"
                    autoComplete="off"
                    value={form.apiKey}
                    disabled={Boolean(lockedBy("apiKey"))}
                    placeholder={
                      settings.hasKey
                        ? t("settings.apiKey.stored")
                        : t("settings.apiKey.paste")
                    }
                    onChange={(e) => set("apiKey", e.target.value)}
                  />
                </label>
                {lockNote("apiKey")}
                {settings.hasKey && !lockedBy("apiKey") && (
                  <p className="key-state">
                    {t("settings.apiKey.stored")}{" "}
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => save({ apiKey: null })}
                    >
                      {t("settings.apiKey.delete")}
                    </button>
                  </p>
                )}
              </>
            )}
            <label>
              {t("settings.model")}
              <input
                type="text"
                value={form.model}
                disabled={Boolean(lockedBy("model"))}
                placeholder={defaultModelOf(settings, form.provider)}
                onChange={(e) => set("model", e.target.value)}
              />
            </label>
            {lockNote("model")}
            <label className="check">
              <input
                type="checkbox"
                checked={form.autoSummary}
                disabled={Boolean(lockedBy("autoSummary"))}
                onChange={(e) => set("autoSummary", e.target.checked)}
              />
              {t("settings.autoSummary")}
            </label>
            {lockNote("autoSummary")}
            <label className="check">
              <input
                type="checkbox"
                checked={form.autoSuggestions}
                disabled={Boolean(lockedBy("autoSuggestions"))}
                onChange={(e) => set("autoSuggestions", e.target.checked)}
              />
              {t("settings.autoSuggestions")}
            </label>
            {lockNote("autoSuggestions")}
            <label className="check">
              <input
                type="checkbox"
                checked={form.ignoreDependencies}
                onChange={(e) => {
                  if (e.target.checked) {
                    setConfirmShow(false);
                    set("ignoreDependencies", true);
                  } else {
                    setConfirmShow(true);
                  }
                }}
              />
              {t("settings.ignoreDependencies")}
            </label>
            {confirmShow && (
              <div role="alert" className="confirm-box">
                <p>{t("settings.ignoreDependencies.confirm")}</p>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      set("ignoreDependencies", false);
                      setConfirmShow(false);
                    }}
                  >
                    {t("settings.ignoreDependencies.yes")}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setConfirmShow(false)}
                  >
                    {t("settings.ignoreDependencies.no")}
                  </button>
                </div>
              </div>
            )}
            {status === "saved" && <p role="status">{t("settings.saved")}</p>}
            {status === "failed" && <p role="alert">{t("settings.failed")}</p>}
            <div className="dialog-actions">
              <button
                type="submit"
                className="btn"
                disabled={status === "saving"}
              >
                {t("settings.save")}
              </button>
              <button type="button" className="btn-ghost" onClick={onClose}>
                {t("settings.close")}
              </button>
            </div>
          </form>
        )}
        {(!settings || !form) && (
          <div className="dialog-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              {t("settings.close")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Where Claude Code is (CC-17): found in green, with its path; a wrong APP8N8_CLAUDE_PATH
 * and a missing one as a warning. "Choose…" opens the system's file chooser; a variable
 * that works needs no choice, so it shows no button.
 */
function ClaudeState({
  settings,
  onChanged,
}: {
  settings: SettingsResponse;
  onChanged: (settings: SettingsResponse) => void;
}) {
  const t = useT();
  const [error, setError] = useState<"not-claude" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const { path, source, envInvalid } = settings.claude;

  async function choose(action: "pick" | "auto") {
    setBusy(true);
    const next = await setClaudePath(action);
    setBusy(false);
    if (next === "not-claude" || next === null) {
      setError(next === null ? "failed" : "not-claude");
      return;
    }
    setError(null);
    onChanged(next);
  }

  return (
    <div className="claude-state">
      {envInvalid && (
        <p className="claude-warn">
          {t("settings.claude.envInvalid", { name: "APP8N8_CLAUDE_PATH" })}
        </p>
      )}
      <div className="claude-row">
        {path ? (
          <p className="claude-ok">
            <button
              type="button"
              className="claude-path"
              aria-label={path}
              data-tip={path}
            >
              <FolderIcon />
            </button>
            {t("settings.claude.found")}
          </p>
        ) : (
          !envInvalid && (
            <p className="claude-warn">{t("settings.claude.missing")}</p>
          )
        )}
        {source !== "env" && (
          <span className="claude-actions">
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => choose("pick")}
            >
              {t(path ? "settings.claude.change" : "settings.claude.pick")}
            </button>
            {source === "picked" && (
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => choose("auto")}
              >
                {t("settings.claude.auto")}
              </button>
            )}
          </span>
        )}
      </div>
      {error && (
        <p className="claude-warn" role="alert">
          {t(
            error === "not-claude"
              ? "settings.claude.notClaude"
              : "settings.claude.pickFailed",
          )}
        </p>
      )}
    </div>
  );
}

/** A folder, as on the start screen: hover or focus it to read the full path of the file. */
function FolderIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Sun for light, moon for dark, a half-filled circle for the system's. */
function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {theme === "light" && (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </>
        )}
        {theme === "dark" && (
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
        )}
        {theme === "system" && (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
          </>
        )}
      </g>
    </svg>
  );
}

/** The sliders that open the settings, on every screen (CFG-20). */
export function SettingsButton({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="btn-ghost settings-btn"
      aria-label={t("settings.title")}
      onClick={onOpen}
    >
      <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19.14 12.94a7.5 7.5 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.68 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.5 7.5 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64z" />
          <circle cx="12" cy="12" r="3" />
        </g>
      </svg>
    </button>
  );
}
