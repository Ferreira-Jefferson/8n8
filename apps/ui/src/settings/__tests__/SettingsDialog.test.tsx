import type { SettingsResponse } from "@8n8/model";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveSettings } from "../../api";
import { patchOf, SettingsDialog } from "../SettingsDialog";

vi.mock("../../api", () => ({ saveSettings: vi.fn() }));
const saveMock = vi.mocked(saveSettings);

beforeEach(() => saveMock.mockReset());
afterEach(cleanup);

const DEFAULT_MODEL = "~deepseek/deepseek-v4-flash-latest";
const view = (over: Partial<SettingsResponse> = {}): SettingsResponse => ({
  provider: "openrouter",
  model: DEFAULT_MODEL,
  autoSummary: false,
  autoSuggestions: false,
  theme: "system",
  hasKey: false,
  providers: [
    { id: "openrouter", defaultModel: DEFAULT_MODEL, usesKey: true },
    { id: "openai-compatible", defaultModel: "gpt-4o-mini", usesKey: true },
    { id: "openai", defaultModel: "gpt-5-nano", usesKey: true },
  ],
  env: {},
  ...over,
});

function open(settings: SettingsResponse | null = view()) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <SettingsDialog settings={settings} onSaved={onSaved} onClose={onClose} />,
  );
  return { onSaved, onClose };
}

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const save = () =>
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

describe("SettingsDialog fields (CFG-20)", () => {
  it("shows provider, key, model and both modes, with the default model as a hint", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Configurações" })).toBeTruthy();
    expect((screen.getByLabelText("Provedor") as HTMLSelectElement).value).toBe(
      "openrouter",
    );
    expect(field("Chave de API").type).toBe("password");
    expect(field("Chave de API").value).toBe("");
    expect(field("Chave de API").placeholder).toBe("Cole a chave");
    expect(screen.queryByLabelText("URL")).toBeNull();
    expect(field("Modelo").value).toBe("");
    expect(field("Modelo").placeholder).toBe(DEFAULT_MODEL);
    expect(field("Gerar o resumo ao selecionar um nó").checked).toBe(false);
    expect(field("Pedir as sugestões ao selecionar um nó").checked).toBe(false);
    expect(screen.queryByRole("button", { name: "Apagar chave" })).toBeNull();
  });

  it("says Chave guardada, never fills the key and offers Apagar chave when a key exists", async () => {
    saveMock.mockResolvedValue(view());
    const { onSaved } = open(view({ hasKey: true }));
    expect(screen.getByText(/Chave guardada/)).toBeTruthy();
    expect(field("Chave de API").value).toBe("");
    expect(field("Chave de API").placeholder).toBe("Chave guardada");
    fireEvent.click(screen.getByRole("button", { name: "Apagar chave" }));
    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith({ apiKey: null }),
    );
    expect(onSaved).toHaveBeenCalledWith(view());
  });

  it("shows a stored model, and the hint and an empty model of the provider picked", () => {
    open(view({ model: "m/x" }));
    expect(field("Modelo").value).toBe("m/x");
    fireEvent.change(screen.getByLabelText("Provedor"), {
      target: { value: "openai" },
    });
    // The model of the old provider means nothing to the new one.
    expect(field("Modelo").value).toBe("");
    expect(field("Modelo").placeholder).toBe("gpt-5-nano");
  });

  it("sends the typed model, trimmed", async () => {
    saveMock.mockResolvedValue(view({ model: "z/novo" }));
    open();
    fireEvent.change(field("Modelo"), { target: { value: " z/novo " } });
    save();
    await screen.findByText("Configurações salvas.");
    expect(saveMock).toHaveBeenCalledWith({ model: "z/novo" });
  });

  it("keeps the model a variable sets when the provider changes", () => {
    open(view({ model: "env/model", env: { model: "APP8N8_MODEL" } }));
    fireEvent.change(screen.getByLabelText("Provedor"), {
      target: { value: "openai" },
    });
    expect(field("Modelo").value).toBe("env/model");
  });

  it("says so when the settings could not be read", () => {
    open(null);
    expect(
      screen.getByText("Não foi possível ler as configurações."),
    ).toBeTruthy();
  });

  it("closes on Fechar and on Escape", () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("SettingsDialog save (CFG-21)", () => {
  it("sends only the fields that changed, then says Configurações salvas.", async () => {
    const saved = view({ hasKey: true, autoSummary: true });
    saveMock.mockResolvedValue(saved);
    const { onSaved } = open();
    fireEvent.change(field("Chave de API"), { target: { value: " sk-x " } });
    fireEvent.click(field("Gerar o resumo ao selecionar um nó"));
    save();
    expect(await screen.findByText("Configurações salvas.")).toBeTruthy();
    expect(saveMock).toHaveBeenCalledWith({
      apiKey: "sk-x",
      autoSummary: true,
    });
    expect(onSaved).toHaveBeenCalledWith(saved);
    // The key field empties after the save.
    expect(field("Chave de API").value).toBe("");
  });

  it("keeps the typed values and shows the error when the server refuses", async () => {
    saveMock.mockResolvedValue(null);
    const { onSaved } = open();
    fireEvent.change(field("Modelo"), { target: { value: "--x" } });
    save();
    expect(
      await screen.findByText(
        "Não foi possível salvar. Confira a chave e o modelo.",
      ),
    ).toBeTruthy();
    expect(field("Modelo").value).toBe("--x");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("sends nothing when nothing changed", async () => {
    open();
    save();
    expect(await screen.findByText("Configurações salvas.")).toBeTruthy();
    expect(saveMock).not.toHaveBeenCalled();
  });
});

describe("SettingsDialog with the environment (CFG-22)", () => {
  it("disables each field a variable sets and names the variable", () => {
    open(
      view({
        hasKey: true,
        env: {
          apiKey: "OPENROUTER_API_KEY",
          autoSummary: "APP8N8_AUTO_SUMMARY",
        },
      }),
    );
    expect(field("Chave de API").disabled).toBe(true);
    expect(field("Gerar o resumo ao selecionar um nó").disabled).toBe(true);
    expect(field("Modelo").disabled).toBe(false);
    expect(
      screen.getByText("Definido pela variável OPENROUTER_API_KEY"),
    ).toBeTruthy();
    expect(
      screen.getByText("Definido pela variável APP8N8_AUTO_SUMMARY"),
    ).toBeTruthy();
    // A key the environment sets cannot be erased from here.
    expect(screen.queryByRole("button", { name: "Apagar chave" })).toBeNull();
  });
});

describe("patchOf", () => {
  const base = {
    provider: "openrouter",
    apiKey: "",
    model: "m/x",
    autoSummary: false,
    autoSuggestions: false,
    theme: "system" as const,
  };

  it("erases a cleared model with null", () => {
    expect(patchOf(base, { ...base, model: " " })).toEqual({ model: null });
  });

  it("sends the theme only when it changed", () => {
    expect(patchOf(base, base)).toEqual({});
    expect(patchOf(base, { ...base, theme: "light" })).toEqual({
      theme: "light",
    });
  });

  it("ignores a blank key and keeps a changed provider", () => {
    expect(
      patchOf(base, { ...base, apiKey: "   ", provider: "openai-compatible" }),
    ).toEqual({ provider: "openai-compatible" });
  });
});

describe("SettingsDialog with claude-code (CC-01)", () => {
  const withClaude = (over: Partial<SettingsResponse> = {}) =>
    view({
      providers: [
        { id: "openrouter", defaultModel: DEFAULT_MODEL, usesKey: true },
        { id: "claude-code", defaultModel: "sonnet", usesKey: false },
      ],
      ...over,
    });

  it("hides the key and says the subscription is enough", () => {
    open(withClaude({ provider: "claude-code", model: "sonnet" }));
    expect(screen.queryByLabelText("Chave de API")).toBeNull();
    expect(
      screen.getByText(
        "O Claude Code usa a sua assinatura. Não precisa de chave.",
      ),
    ).toBeTruthy();
    expect(field("Modelo").placeholder).toBe("sonnet");
  });

  it("switches to claude-code and sends only the provider", async () => {
    saveMock.mockResolvedValue(withClaude({ provider: "claude-code" }));
    open(withClaude());
    fireEvent.change(screen.getByLabelText("Provedor"), {
      target: { value: "claude-code" },
    });
    expect(screen.queryByLabelText("Chave de API")).toBeNull();
    save();
    await screen.findByText("Configurações salvas.");
    expect(saveMock).toHaveBeenCalledWith({ provider: "claude-code" });
  });
});
