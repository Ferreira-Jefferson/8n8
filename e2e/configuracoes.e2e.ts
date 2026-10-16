import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_TOKEN } from "../playwright.config";
import { type FakeCall, fakeLog, resetFake } from "./fake-llm";
import { LANE_PORT, laneDir, lanePort } from "./lane";
import { clickCard, generate, panel } from "./mapa";
import { expect, type Page, test } from "./test";

// Feature 08, end to end: the server of 4322 starts with no key and no automatic
// mode. The settings go in through the dialog, the summary and the suggestions wait
// for a click, and what is cached shows with no click.

const SETTINGS = `http://127.0.0.1:${lanePort(LANE_PORT.settings)}`;
const REPO = fileURLToPath(new URL("..", import.meta.url));
const CACHE = join(REPO, ".cache", laneDir("e2e-settings"));
const CONFIG = join(
  REPO,
  ".cache",
  laneDir("e2e-settings-config"),
  "config.json",
);
const FAKE_KEY = "e2e-fake-key";
// A function the fake LLM summarizes and its reviewer accepts (fake-llm.ts).
const CONTAGEM =
  "def total_sem_doc(itens):\n    n = len(itens)\n    print(n)\n    return n\n";
const FN = "fn:total_sem_doc";

const HEADERS = {
  "x-8n8-token": E2E_TOKEN,
  "content-type": "application/json",
};

/** Puts the server back to no key, the default provider and both modes off, through its own API. */
async function resetSettings(page: Page): Promise<void> {
  const res = await page.request.put(`${SETTINGS}/api/settings`, {
    headers: HEADERS,
    data: {
      provider: "openrouter",
      apiKey: null,
      autoSummary: false,
      autoSuggestions: false,
      theme: "system",
    },
  });
  expect(res.status()).toBe(200);
}

/** The calls of the summary and the suggestions; titles stay automatic with a provider (AD-017). */
const roles = (log: FakeCall[]) =>
  log.map((c) => c.role).filter((role) => !role.startsWith("title"));

async function openFunction(page: Page): Promise<void> {
  await generate(page, SETTINGS, CONTAGEM);
  await clickCard(page, FN);
}

async function saveInDialog(
  page: Page,
  fill: (dialog: ReturnType<Page["getByRole"]>) => Promise<void>,
): Promise<void> {
  await page.getByRole("button", { name: "Configurações" }).click();
  const dialog = page.getByRole("dialog", { name: "Configurações" });
  await fill(dialog);
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog.getByText("Configurações salvas.")).toBeVisible();
  await dialog.getByRole("button", { name: "Fechar" }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe("Configurações e LLM sob demanda", () => {
  test.beforeEach(async ({ page }) => {
    await resetSettings(page);
    rmSync(CACHE, { recursive: true, force: true });
    await resetFake();
  });

  test("o tema escolhido nas configurações vale para a tela inicial e o mapa, e sobrevive ao recarregar", async ({
    page,
  }) => {
    const GROUND_LIGHT = "rgb(242, 243, 240)";
    const GROUND_DARK = "rgb(22, 24, 24)";
    const bg = () =>
      page
        .locator("body")
        .evaluate((el) => getComputedStyle(el).backgroundColor);

    // The system is dark (playwright.config.ts).
    await page.goto(SETTINGS);
    expect(await bg()).toBe(GROUND_DARK);

    // The icon at the right of the title cycles system → light → dark, saving on each click.
    await page.getByRole("button", { name: "Configurações" }).click();
    const dialog = page.getByRole("dialog", { name: "Configurações" });
    await dialog
      .getByRole("button", { name: "Tema: Seguir o sistema" })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Tema: Claro" }),
    ).toBeVisible();
    expect(await bg()).toBe(GROUND_LIGHT);
    await dialog.getByRole("button", { name: "Fechar" }).click();

    // The choice is stored by the server, so a reload keeps it.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await bg()).toBe(GROUND_LIGHT);

    // The map screen has the same theme.
    await generate(page, SETTINGS, CONTAGEM);
    expect(await bg()).toBe(GROUND_LIGHT);

    await page.getByRole("button", { name: "Configurações" }).click();
    await dialog.getByRole("button", { name: "Tema: Claro" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await dialog.getByRole("button", { name: "Tema: Escuro" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    expect(await bg()).toBe(GROUND_DARK);
  });

  test("CFG-06, CFG-09: with no provider a node asks nothing, the click says what to configure and opens the settings", async ({
    page,
  }) => {
    await openFunction(page);
    const view = panel(page);
    await expect(
      view.getByRole("button", { name: "Gerar resumo" }),
    ).toBeVisible();
    await expect(
      view.getByRole("button", { name: "Pedir sugestões" }),
    ).toBeVisible();

    await view.getByRole("button", { name: "Gerar resumo" }).click();
    await expect(
      view.getByText("Configure um provedor de LLM em Configurações."),
    ).toBeVisible();
    await view.getByRole("button", { name: "Abrir configurações" }).click();
    await expect(
      page.getByRole("dialog", { name: "Configurações" }),
    ).toBeVisible();
    expect(await fakeLog()).toEqual([]);
  });

  test("CFG-07, CFG-17, CFG-19: a key saved in the dialog turns the LLM on with no restart; the click asks the summary only, and the cache shows with no click", async ({
    page,
  }) => {
    await openFunction(page);
    await saveInDialog(page, async (dialog) => {
      await dialog.getByLabel("Chave de API").fill(FAKE_KEY);
    });
    // The settings live in the config file of the server.
    expect(JSON.parse(readFileSync(CONFIG, "utf8"))).toMatchObject({
      apiKey: FAKE_KEY,
    });

    // Selecting again asks the cache only: nothing is spent on the explanation.
    await clickCard(page, FN);
    const view = panel(page);
    await expect(
      view.getByRole("button", { name: "Gerar resumo" }),
    ).toBeVisible();
    expect(roles(await fakeLog())).toEqual([]);

    await view.getByRole("button", { name: "Gerar resumo" }).click();
    await expect(view.getByRole("list", { name: "Resumo" })).toBeVisible();
    const afterClick = roles(await fakeLog());
    expect(afterClick).toContain("draft");
    expect(afterClick).not.toContain("suggest");
    await expect(
      view.getByRole("button", { name: "Pedir sugestões" }),
    ).toBeVisible();

    // A new map of the same code: the summary comes from the cache, with no click.
    await openFunction(page);
    await expect(
      panel(page).getByRole("list", { name: "Resumo" }),
    ).toBeVisible();
    expect(roles(await fakeLog())).toEqual(afterClick);
  });

  test("CFG-08, CFG-20: the automatic modes of the dialog ask both parts on selection", async ({
    page,
  }) => {
    await openFunction(page);
    await saveInDialog(page, async (dialog) => {
      await dialog.getByLabel("Chave de API").fill(FAKE_KEY);
      await dialog.getByLabel("Gerar o resumo ao selecionar um nó").check();
      await dialog.getByLabel("Pedir as sugestões ao selecionar um nó").check();
    });

    await openFunction(page);
    const view = panel(page);
    await expect(view.getByRole("list", { name: "Resumo" })).toBeVisible();
    await expect(
      view.getByText("Nenhuma sugestão para este nó."),
    ).toBeVisible();
    expect(roles(await fakeLog())).toEqual(
      expect.arrayContaining(["draft", "suggest"]),
    );
    await expect(
      view.getByRole("button", { name: "Gerar resumo" }),
    ).toHaveCount(0);
  });

  test("CFG-12, CFG-15, CFG-22: the dialog says a key is stored and never shows it; a new provider erases it; a variable locks its field", async ({
    page,
  }) => {
    await page.goto(`${SETTINGS}/`);
    await saveInDialog(page, async (dialog) => {
      await dialog.getByLabel("Chave de API").fill(FAKE_KEY);
    });
    const view = await page.request.get(`${SETTINGS}/api/settings`, {
      headers: HEADERS,
    });
    const body = await view.text();
    expect(body).toContain('"hasKey":true');
    expect(body).not.toContain(FAKE_KEY);

    await page.getByRole("button", { name: "Configurações" }).click();
    const dialog = page.getByRole("dialog", { name: "Configurações" });
    await expect(dialog.getByText(/Chave guardada/)).toBeVisible();
    await expect(dialog.getByLabel("Chave de API")).toHaveValue("");
    // APP8N8_MODEL is set for this server.
    await expect(dialog.getByLabel("Modelo")).toBeDisabled();
    await expect(dialog.getByLabel("Modelo")).toHaveValue("e2e/drafter");
    await expect(
      dialog.getByText("Definido pela variável APP8N8_MODEL"),
    ).toBeVisible();

    await dialog.getByLabel("Provedor").selectOption("anthropic");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(dialog.getByText("Configurações salvas.")).toBeVisible();
    await expect(dialog.getByText(/Chave guardada/)).toHaveCount(0);
    expect(JSON.parse(readFileSync(CONFIG, "utf8"))).toEqual({
      provider: "anthropic",
      autoSummary: false,
      autoSuggestions: false,
      theme: "system",
    });
  });

  test("CFG-14, CFG-21: the dialog has no URL field, and the server refuses a base URL in the settings", async ({
    page,
  }) => {
    await page.goto(`${SETTINGS}/`);
    await page.getByRole("button", { name: "Configurações" }).click();
    const dialog = page.getByRole("dialog", { name: "Configurações" });
    for (const provider of ["openrouter", "openai", "anthropic"]) {
      await dialog.getByLabel("Provedor").selectOption(provider);
      await expect(dialog.getByLabel("URL")).toHaveCount(0);
    }
    // The URL comes only from the environment of the server.
    const res = await page.request.put(`${SETTINGS}/api/settings`, {
      headers: HEADERS,
      data: { baseURL: "http://127.0.0.1:8288/v1" },
    });
    expect(res.status()).toBe(400);
  });

  test("CC-01: choosing claude-code hides the key, with no note about the subscription", async ({
    page,
  }) => {
    await page.goto(`${SETTINGS}/`);
    await page.getByRole("button", { name: "Configurações" }).click();
    const dialog = page.getByRole("dialog", { name: "Configurações" });
    await expect(dialog.getByLabel("Chave de API")).toBeVisible();
    await dialog.getByLabel("Provedor").selectOption("claude-code");
    await expect(dialog.getByLabel("Chave de API")).toHaveCount(0);
    await expect(dialog.getByText(/assinatura/)).toHaveCount(0);
    // The server's APP8N8_CLAUDE_PATH names no file (NO_CLAUDE): the dialog says so (CC-17).
    await expect(
      dialog.getByText(
        "O caminho em APP8N8_CLAUDE_PATH não tem o Claude Code. Escolha o executável.",
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Escolher…" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(dialog.getByText("Configurações salvas.")).toBeVisible();
    expect(JSON.parse(readFileSync(CONFIG, "utf8"))).toMatchObject({
      provider: "claude-code",
    });
  });

  test("CC-12, CC-18: the server never takes the Claude Code path from a request", async ({
    page,
  }) => {
    for (const data of [
      { action: "pick", path: "C:\\Windows\\System32\\calc.exe" },
      { path: "C:\\Windows\\System32\\calc.exe" },
    ]) {
      const res = await page.request.post(
        `${SETTINGS}/api/settings/claude-path`,
        { headers: HEADERS, data },
      );
      expect(res.status()).toBe(400);
    }
    const put = await page.request.put(`${SETTINGS}/api/settings`, {
      headers: HEADERS,
      data: { claudePath: "C:\\Windows\\System32\\calc.exe" },
    });
    expect(put.status()).toBe(400);
    expect(readFileSync(CONFIG, "utf8")).not.toContain("calc.exe");
  });
});
