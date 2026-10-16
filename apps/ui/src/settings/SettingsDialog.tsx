import {
  type SettingsField,
  type SettingsPatch,
  type SettingsResponse,
  THEMES,
  type Theme,
} from "@8n8/model";
import { useEffect, useId, useState } from "react";
import { saveSettings } from "../api";

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
}

const THEME_LABELS: Record<Theme, string> = {
  system: "Seguir o sistema",
  light: "Claro",
  dark: "Escuro",
};

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
  const [form, setForm] = useState<Form | null>(
    settings ? formOf(settings) : null,
  );
  const [status, setStatus] = useState<Status>("idle");
  const [theme, setTheme] = useState<Theme | null>(settings?.theme ?? null);

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
      <small className="locked">{`Definido pela variável ${lockedBy(field)}`}</small>
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
          <h2 id={titleId}>Configurações</h2>
          {theme && (
            <button
              type="button"
              className="btn-ghost theme-btn"
              aria-label={`Tema: ${THEME_LABELS[theme]}`}
              title={`Tema: ${THEME_LABELS[theme]}`}
              onClick={() => switchTheme(theme)}
            >
              <ThemeIcon theme={theme} />
            </button>
          )}
        </div>
        {!settings || !form ? (
          <p>Não foi possível ler as configurações.</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save(patchOf(formOf(settings), form));
            }}
          >
            <label>
              Provedor
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
            {!usesKey(settings, form.provider) ? (
              <p className="key-state">
                O Claude Code usa a sua assinatura. Não precisa de chave.
              </p>
            ) : (
              <>
                <label>
                  Chave de API
                  <input
                    type="password"
                    autoComplete="off"
                    value={form.apiKey}
                    disabled={Boolean(lockedBy("apiKey"))}
                    placeholder={
                      settings.hasKey ? "Chave guardada" : "Cole a chave"
                    }
                    onChange={(e) => set("apiKey", e.target.value)}
                  />
                </label>
                {lockNote("apiKey")}
                {settings.hasKey && !lockedBy("apiKey") && (
                  <p className="key-state">
                    Chave guardada{" "}
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => save({ apiKey: null })}
                    >
                      Apagar chave
                    </button>
                  </p>
                )}
              </>
            )}
            <label>
              Modelo
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
              Gerar o resumo ao selecionar um nó
            </label>
            {lockNote("autoSummary")}
            <label className="check">
              <input
                type="checkbox"
                checked={form.autoSuggestions}
                disabled={Boolean(lockedBy("autoSuggestions"))}
                onChange={(e) => set("autoSuggestions", e.target.checked)}
              />
              Pedir as sugestões ao selecionar um nó
            </label>
            {lockNote("autoSuggestions")}
            {status === "saved" && <p role="status">Configurações salvas.</p>}
            {status === "failed" && (
              <p role="alert">
                Não foi possível salvar. Confira a chave e o modelo.
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="submit"
                className="btn"
                disabled={status === "saving"}
              >
                Salvar
              </button>
              <button type="button" className="btn-ghost" onClick={onClose}>
                Fechar
              </button>
            </div>
          </form>
        )}
        {(!settings || !form) && (
          <div className="dialog-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
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
  return (
    <button
      type="button"
      className="btn-ghost settings-btn"
      aria-label="Configurações"
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
