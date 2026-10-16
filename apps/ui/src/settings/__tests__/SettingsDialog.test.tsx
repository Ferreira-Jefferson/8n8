import type { SettingsResponse } from "@8n8/model";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveSettings, setClaudePath } from "../../api";
import { patchOf, SettingsDialog } from "../SettingsDialog";

vi.mock("../../api", () => ({ saveSettings: vi.fn(), setClaudePath: vi.fn() }));
const saveMock = vi.mocked(saveSettings);
const claudeMock = vi.mocked(setClaudePath);

beforeEach(() => {
  saveMock.mockReset();
  claudeMock.mockReset();
});
afterEach(cleanup);

const DEFAULT_MODEL = "~deepseek/deepseek-v4-flash-latest";
const view = (over: Partial<SettingsResponse> = {}): SettingsResponse => ({
  provider: "openrouter",
  model: DEFAULT_MODEL,
  autoSummary: false,
  autoSuggestions: false,
  theme: "system",
  locale: "pt-BR",
  hasKey: false,
  providers: [
    { id: "openrouter", defaultModel: DEFAULT_MODEL, usesKey: true },
    { id: "openai-compatible", defaultModel: "gpt-4o-mini", usesKey: true },
    { id: "openai", defaultModel: "gpt-5-nano", usesKey: true },
  ],
  env: {},
  claude: { path: null, source: null, envInvalid: false },
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
    expect(field("Resumo automático").checked).toBe(false);
    expect(field("Sugestão automática").checked).toBe(false);
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
    fireEvent.click(field("Resumo automático"));
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

describe("SettingsDialog theme button", () => {
  it("shows the theme by its icon and saves the next one on the click", async () => {
    saveMock.mockResolvedValue(view({ theme: "light" }));
    const { onSaved } = open();
    expect(screen.queryByLabelText("Tema")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Tema: Seguir o sistema" }),
    );
    await screen.findByRole("button", { name: "Tema: Claro" });
    expect(saveMock).toHaveBeenCalledWith({ theme: "light" });
    expect(onSaved).toHaveBeenCalledWith(view({ theme: "light" }));
  });

  it("goes from dark back to the system's", async () => {
    saveMock.mockResolvedValue(view());
    open(view({ theme: "dark" }));
    fireEvent.click(screen.getByRole("button", { name: "Tema: Escuro" }));
    await screen.findByRole("button", { name: "Tema: Seguir o sistema" });
    expect(saveMock).toHaveBeenCalledWith({ theme: "system" });
  });

  it("keeps the theme and shows the error when the server refuses", async () => {
    saveMock.mockResolvedValue(null);
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "Tema: Seguir o sistema" }),
    );
    expect(
      await screen.findByText(
        "Não foi possível salvar. Confira a chave e o modelo.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Tema: Seguir o sistema" }),
    ).toBeTruthy();
  });
});

describe("SettingsDialog language button", () => {
  it("shows BR, with no select, and saves English on the click", async () => {
    saveMock.mockResolvedValue(view({ locale: "en" }));
    const { onSaved } = open();
    const btn = screen.getByRole("button", {
      name: "Idioma: Português (Brasil)",
    });
    expect(btn.textContent).toBe("BR");
    expect(screen.queryByLabelText("Idioma")).toBeNull();
    fireEvent.click(btn);
    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith({ locale: "en" }),
    );
    expect(onSaved).toHaveBeenCalledWith(view({ locale: "en" }));
  });

  it("goes from EN back to BR", async () => {
    saveMock.mockResolvedValue(view());
    open(view({ locale: "en" }));
    fireEvent.click(screen.getByRole("button", { name: /Idioma: English/ }));
    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith({ locale: "pt-BR" }),
    );
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
    expect(field("Resumo automático").disabled).toBe(true);
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
  };

  it("erases a cleared model with null", () => {
    expect(patchOf(base, { ...base, model: " " })).toEqual({ model: null });
  });

  it("sends nothing when nothing changed", () => {
    expect(patchOf(base, base)).toEqual({});
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

  it("hides the key and adds no note about the subscription", () => {
    open(withClaude({ provider: "claude-code", model: "sonnet" }));
    expect(screen.queryByLabelText("Chave de API")).toBeNull();
    expect(screen.queryByText(/assinatura/)).toBeNull();
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

describe("SettingsDialog: where Claude Code is (CC-17, CC-18)", () => {
  const PATH = "C:/npm/claude.exe";
  const claude = (c: Partial<SettingsResponse["claude"]>) =>
    view({
      provider: "claude-code",
      model: "claude-sonnet-5-5",
      providers: [
        { id: "openrouter", defaultModel: DEFAULT_MODEL, usesKey: true },
        {
          id: "claude-code",
          defaultModel: "claude-sonnet-5-5",
          usesKey: false,
        },
      ],
      claude: { path: null, source: null, envInvalid: false, ...c },
    });
  const button = (name: string) => screen.queryByRole("button", { name });

  it("says Claude Code was found, in green, keeps the path behind a folder icon and offers to change it", () => {
    open(claude({ path: PATH, source: "auto" }));
    const found = screen.getByText("Claude Code encontrado.");
    expect(found.className).toBe("claude-ok");
    // The path is not text on the screen: the folder icon names it and shows it as a tooltip.
    expect(screen.queryByText(PATH)).toBeNull();
    const folder = screen.getByRole("button", { name: PATH });
    expect(folder.getAttribute("data-tip")).toBe(PATH);
    expect(button("Alterar")).toBeTruthy();
    expect(button("Escolher…")).toBeNull();
    expect(button("Usar o automático")).toBeNull();
  });

  it("shows no button when a variable that works sets the path", () => {
    open(claude({ path: PATH, source: "env" }));
    expect(screen.getByText("Claude Code encontrado.")).toBeTruthy();
    expect(button("Alterar")).toBeNull();
    expect(button("Escolher…")).toBeNull();
  });

  it("says a wrong variable has no Claude Code, and offers to choose", () => {
    open(claude({ envInvalid: true }));
    expect(
      screen.getByText(
        "O caminho em APP8N8_CLAUDE_PATH não tem o Claude Code. Escolha o executável.",
      ).className,
    ).toBe("claude-warn");
    expect(screen.queryByText("Claude Code encontrado.")).toBeNull();
    expect(button("Escolher…")).toBeTruthy();
  });

  it("says Claude Code was not found when nothing points to it", () => {
    open(claude({}));
    expect(
      screen.getByText("Claude Code não encontrado. Escolha o executável."),
    ).toBeTruthy();
  });

  it("shows nothing about Claude Code for another provider", () => {
    open(claude({ path: PATH, source: "auto" }));
    fireEvent.change(screen.getByLabelText("Provedor"), {
      target: { value: "openrouter" },
    });
    expect(screen.queryByText("Claude Code encontrado.")).toBeNull();
    expect(button("Alterar")).toBeNull();
    expect(button("Escolher…")).toBeNull();
  });

  it("asks the server to open the chooser and shows the answer", async () => {
    const picked = claude({ path: "D:/tools/claude.exe", source: "picked" });
    claudeMock.mockResolvedValue(picked);
    const { onSaved } = open(claude({}));
    fireEvent.click(button("Escolher…") as HTMLElement);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(picked));
    expect(claudeMock).toHaveBeenCalledWith("pick");
  });

  it("goes back to the automatic lookup from a picked file", async () => {
    claudeMock.mockResolvedValue(claude({ path: PATH, source: "auto" }));
    const { onSaved } = open(
      claude({ path: "D:/c/claude.exe", source: "picked" }),
    );
    fireEvent.click(button("Usar o automático") as HTMLElement);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(claudeMock).toHaveBeenCalledWith("auto");
  });

  it("says when the chosen file is not Claude Code, or the chooser failed", async () => {
    open(claude({}));
    claudeMock.mockResolvedValueOnce("not-claude");
    fireEvent.click(button("Escolher…") as HTMLElement);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Esse arquivo não é o Claude Code.",
    );
    claudeMock.mockResolvedValueOnce(null);
    fireEvent.click(button("Escolher…") as HTMLElement);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "A janela de arquivo não abriu.",
      ),
    );
  });
});
