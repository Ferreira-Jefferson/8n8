import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { E2E_TOKEN } from "../playwright.config";
import { type FakeCall, fakeLog, resetFake } from "./fake-llm";
import { clickCard, generate, panel } from "./mapa";

// Feature 08, end to end: the server of 4322 starts with no key and no automatic
// mode. The settings go in through the dialog, the summary and the suggestions wait
// for a click, and what is cached shows with no click.

const SETTINGS = "http://127.0.0.1:4322";
const REPO = fileURLToPath(new URL("..", import.meta.url));
const CACHE = join(REPO, ".cache", "e2e-settings");
const CONFIG = join(REPO, ".cache", "e2e-settings-config", "config.json");
const FAKE_URL = "http://127.0.0.1:4318/v1";
const FAKE_KEY = "e2e-fake-key";
// A function the fake LLM summarizes and its reviewer accepts (fake-llm.ts).
const CONTAGEM =
  "def total_sem_doc(itens):\n    n = len(itens)\n    print(n)\n    return n\n";
const FN = "fn:total_sem_doc";

const HEADERS = {
  "x-8n8-token": E2E_TOKEN,
  "content-type": "application/json",
};

/** Puts the server back to no key, no URL and both modes off, through its own API. */
async function resetSettings(page: Page): Promise<void> {
  const res = await page.request.put(`${SETTINGS}/api/settings`, {
    headers: HEADERS,
    data: {
      apiKey: null,
      baseURL: null,
      autoSummary: false,
      autoSuggestions: false,
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

  test("CFG-07, CFG-17, CFG-19: a key and URL saved in the dialog turn the LLM on with no restart; the click asks the summary only, and the cache shows with no click", async ({
    page,
  }) => {
    await openFunction(page);
    await saveInDialog(page, async (dialog) => {
      await dialog.getByLabel("Chave de API").fill(FAKE_KEY);
      await dialog.getByLabel("URL").fill(FAKE_URL);
    });
    // The settings live in the config file of the server.
    expect(JSON.parse(readFileSync(CONFIG, "utf8"))).toMatchObject({
      apiKey: FAKE_KEY,
      baseURL: FAKE_URL,
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
      await dialog.getByLabel("URL").fill(FAKE_URL);
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

  test("CFG-12, CFG-15, CFG-22: the dialog says a key is stored and never shows it; a new URL erases it; a variable locks its field", async ({
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
    await expect(
      dialog.getByText("Definido pela variável APP8N8_MODEL"),
    ).toBeVisible();

    await dialog.getByLabel("URL").fill(FAKE_URL);
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(dialog.getByText("Configurações salvas.")).toBeVisible();
    await expect(dialog.getByText(/Chave guardada/)).toHaveCount(0);
    expect(JSON.parse(readFileSync(CONFIG, "utf8"))).toEqual({
      autoSummary: false,
      autoSuggestions: false,
      baseURL: FAKE_URL,
    });
  });

  test("CFG-21: the server refuses a URL that is not http(s), and the dialog keeps what was typed", async ({
    page,
  }) => {
    await page.goto(`${SETTINGS}/`);
    await page.getByRole("button", { name: "Configurações" }).click();
    const dialog = page.getByRole("dialog", { name: "Configurações" });
    // The field type stops a bad URL in the browser; the server refuses it too.
    await dialog.getByLabel("URL").evaluate((el) => {
      (el as HTMLInputElement).type = "text";
    });
    await dialog.getByLabel("URL").fill("ftp://127.0.0.1/v1");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(
      dialog.getByText("Não foi possível salvar. Confira a URL e a chave."),
    ).toBeVisible();
    await expect(dialog.getByLabel("URL")).toHaveValue("ftp://127.0.0.1/v1");
  });
});
