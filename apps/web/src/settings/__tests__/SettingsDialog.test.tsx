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
  hasKey: false,
  providers: [
    { id: "openrouter", defaultModel: DEFAULT_MODEL },
    { id: "openai-compatible", defaultModel: "gpt-4o-mini" },
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
  it("shows provider, key, URL, model and both modes, with the default model as a hint", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Configurações" })).toBeTruthy();
    expect((screen.getByLabelText("Provedor") as HTMLSelectElement).value).toBe(
      "openrouter",
    );
    expect(field("Chave de API").type).toBe("password");
    expect(field("Chave de API").value).toBe("");
    expect(field("Chave de API").placeholder).toBe("Cole a chave");
    expect(field("URL").value).toBe("");
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

  it("shows a stored model and URL, and the hint of the provider picked", () => {
    open(view({ model: "m/x", baseURL: "http://127.0.0.1:9/v1" }));
    expect(field("Modelo").value).toBe("m/x");
    expect(field("URL").value).toBe("http://127.0.0.1:9/v1");
    fireEvent.change(screen.getByLabelText("Provedor"), {
      target: { value: "openai-compatible" },
    });
    expect(field("Modelo").placeholder).toBe("gpt-4o-mini");
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
    fireEvent.change(field("URL"), { target: { value: "ftp://x" } });
    save();
    expect(
      await screen.findByText(
        "Não foi possível salvar. Confira a URL e a chave.",
      ),
    ).toBeTruthy();
    expect(field("URL").value).toBe("ftp://x");
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
    baseURL: "http://a",
    model: "m/x",
    autoSummary: false,
    autoSuggestions: false,
  };

  it("erases a cleared URL and model with null", () => {
    expect(patchOf(base, { ...base, baseURL: "", model: " " })).toEqual({
      baseURL: null,
      model: null,
    });
  });

  it("ignores a blank key and keeps a changed provider", () => {
    expect(
      patchOf(base, { ...base, apiKey: "   ", provider: "openai-compatible" }),
    ).toEqual({ provider: "openai-compatible" });
  });
});
