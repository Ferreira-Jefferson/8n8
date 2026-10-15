import type {
  SettingsField,
  SettingsPatch,
  SettingsResponse,
} from "@8n8/model";
import { useEffect, useId, useState } from "react";
import { saveSettings } from "../api";

export interface SettingsDialogProps {
  /** The effective settings; null when the server could not answer. */
  settings: SettingsResponse | null;
  onSaved: (settings: SettingsResponse) => void;
  onClose: () => void;
}

/** The text fields as typed; an empty model or URL means the provider's default. */
interface Form {
  provider: string;
  apiKey: string;
  baseURL: string;
  model: string;
  autoSummary: boolean;
  autoSuggestions: boolean;
}

const defaultModelOf = (settings: SettingsResponse, provider: string) =>
  settings.providers.find((p) => p.id === provider)?.defaultModel ?? "";

function formOf(settings: SettingsResponse): Form {
  return {
    provider: settings.provider,
    apiKey: "",
    baseURL: settings.baseURL ?? "",
    // The default model shows as the field's hint, not as a stored value.
    model:
      settings.model === defaultModelOf(settings, settings.provider)
        ? ""
        : settings.model,
    autoSummary: settings.autoSummary,
    autoSuggestions: settings.autoSuggestions,
  };
}

/** Only the fields that changed; a cleared URL or model erases the stored one (CFG-21). */
export function patchOf(before: Form, after: Form): SettingsPatch {
  const patch: SettingsPatch = {};
  if (after.provider !== before.provider) patch.provider = after.provider;
  if (after.apiKey.trim() !== "") patch.apiKey = after.apiKey.trim();
  if (after.baseURL.trim() !== before.baseURL) {
    patch.baseURL = after.baseURL.trim() || null;
  }
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

/** Provider, key, URL, model and the automatic modes; a field the environment sets stays read-only (CFG-20, CFG-21, CFG-22). */
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

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
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
        <h2 id={titleId}>Configurações</h2>
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
                onChange={(e) => set("provider", e.target.value)}
              >
                {settings.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id}
                  </option>
                ))}
              </select>
            </label>
            {lockNote("provider")}
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
            <label>
              URL
              <input
                type="url"
                value={form.baseURL}
                disabled={Boolean(lockedBy("baseURL"))}
                placeholder="Padrão do provedor"
                onChange={(e) => set("baseURL", e.target.value)}
              />
            </label>
            {lockNote("baseURL")}
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
                Não foi possível salvar. Confira a URL e a chave.
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

/** The gear that opens the settings, on every screen (CFG-20). */
export function SettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="btn-ghost settings-btn"
      aria-label="Configurações"
      onClick={onOpen}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8.1-2.6 1.7 1.3-1.8 3.1-2-.8a7.6 7.6 0 0 1-2.2 1.3l-.3 2.1h-3.6l-.3-2.1a7.6 7.6 0 0 1-2.2-1.3l-2 .8-1.8-3.1 1.7-1.3a7.8 7.8 0 0 1 0-2.6L3.6 9l1.8-3.1 2 .8A7.6 7.6 0 0 1 9.6 5.4l.3-2.1h3.6l.3 2.1a7.6 7.6 0 0 1 2.2 1.3l2-.8L19.8 9l-1.7 1.3a7.8 7.8 0 0 1 0 2.6Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
