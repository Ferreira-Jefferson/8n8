import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "./test";

// The hub: each level draws the open node on its left, wired to the nodes no
// other wire reaches, with a round button that goes back one level. A file
// level hides loose code that runs no call (the docstring and constants).
// Real build, real server with no key, real disk.

const ACESSO = [
  '"""Login único do IA Lab System no backend do NIPs.',
  "",
  "O frontend repassa o JWT da sessão.",
  '"""',
  "",
  "from __future__ import annotations",
  "",
  "import os",
  "from typing import Dict, Tuple",
  "",
  'MODULO = "nips"',
  'ROTAS_LIVRES = {"/", "/health"}',
  "_CACHE_SEG = 60",
  "_cache: Dict[str, Tuple[float, bool]] = {}",
  "",
  "",
  "def ativo():",
  '    return bool(os.environ.get("SUPABASE_URL"))',
  "",
  "",
  "def pode_acessar(token):",
  "    ligado = ativo()",
  "    return ligado and token in _cache",
  "",
].join("\n");

let tmp = "";
let APP = "";

test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "8n8-no-pai-"));
  APP = join(tmp, "app");
  mkdirSync(APP);
  writeFileSync(join(APP, "acesso.py"), ACESSO);
  // Loose code that runs a call on import: it stays a card.
  writeFileSync(
    join(APP, "boot.py"),
    'import os\n\nos.makedirs("saida", exist_ok=True)\n',
  );
  for (const name of ["a", "b", "c", "d"]) {
    writeFileSync(join(APP, `${name}.py`), `def ${name}():\n    return 1\n`);
  }
});

test.afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const canvas = (page: Page) => page.getByRole("application");
const children = (page: Page) =>
  canvas(page).locator('[aria-roledescription="node"]:not(.hub-node)');
const hub = (page: Page) =>
  canvas(page).locator('[aria-roledescription="node"].hub-node');
const containsWires = (page: Page) =>
  canvas(page).locator('[aria-roledescription="edge"].edge-contains');
const backCircle = (page: Page) =>
  canvas(page).getByRole("button", { name: "Nível anterior" });
const nodeById = (page: Page, id: string) =>
  canvas(page).locator(`[aria-roledescription="node"][data-id="${id}"]`);
const breadcrumb = (page: Page) =>
  page.getByRole("navigation", { name: "Caminho de navegação" });
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Detalhe do nó" });

async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Caminho da pasta").fill(APP);
  await page.getByRole("button", { name: "Mapear pasta" }).click();
  await expect(children(page)).toHaveCount(6);
}

async function clickCard(page: Page, id: string): Promise<void> {
  const card = nodeById(page, id);
  await expect(card).toBeVisible();
  await card.dispatchEvent("click");
}

test.describe("Nó-pai", () => {
  test("the top level hangs every file from the app hub, in a grid, with no back button", async ({
    page,
  }) => {
    await openApp(page);
    await expect(hub(page)).toHaveCount(1);
    await expect(hub(page)).toHaveAttribute("data-id", "hub:root");
    await expect(hub(page).locator(".tag")).toHaveText("PASTA");
    await expect(hub(page).locator(".name")).toHaveText("app");
    await expect(hub(page).locator(".open-mark")).toHaveCount(0);
    await expect(backCircle(page)).toHaveCount(0);
    // No import between the files: one contains wire per file.
    await expect(containsWires(page)).toHaveCount(6);
    // Six files make a grid, not one tall column.
    const xs = await children(page).evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().left)),
    );
    expect(new Set(xs).size).toBeGreaterThan(1);
    await expect(hub(page).getByTitle("6 nós")).toHaveText("6");
    await expect(page.locator(".node-count")).toHaveCount(0);
  });

  test("acesso.py shows the file as hub and its two functions, never the docstring as CÓDIGO SOLTO", async ({
    page,
  }) => {
    await openApp(page);
    await clickCard(page, "file:acesso.py");
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "app",
      "acesso.py",
    ]);
    await expect(hub(page)).toHaveAttribute("data-id", "file:acesso.py");
    await expect(hub(page).locator(".tag")).toHaveText("ARQUIVO");
    await expect(backCircle(page)).toHaveCount(1);
    expect(
      await children(page).evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-id")),
      ),
    ).toEqual(["file:acesso.py/fn:ativo", "file:acesso.py/fn:pode_acessar"]);
    await expect(canvas(page).locator('[data-tag="CÓDIGO SOLTO"]')).toHaveCount(
      0,
    );
    await expect(hub(page).getByTitle("2 nós")).toHaveText("2");
    await expect(page.locator(".node-count")).toHaveCount(0);
    // pode_acessar calls ativo: only pode_acessar hangs from the hub.
    await expect(containsWires(page)).toHaveCount(1);
    await expect(
      canvas(page).getByRole("group", {
        name: "Aresta de file:acesso.py para file:acesso.py/fn:pode_acessar",
      }),
    ).toHaveCount(1);
  });

  test("a click on the hub shows the whole file, docstring and constants included", async ({
    page,
  }) => {
    await openApp(page);
    await clickCard(page, "file:acesso.py");
    await expect(hub(page)).toBeVisible();
    await hub(page).dispatchEvent("click");
    await expect(panel(page)).toContainText("MODULO");
    await expect(panel(page)).toContainText("Login único do IA Lab System");
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "app",
      "acesso.py",
    ]);
  });

  test("the back circle goes back one level and selects the card you came from", async ({
    page,
  }) => {
    await openApp(page);
    await clickCard(page, "file:acesso.py");
    await expect(backCircle(page)).toBeVisible();
    await backCircle(page).click();
    await expect(breadcrumb(page).getByRole("button")).toHaveText(["app"]);
    await expect(children(page)).toHaveCount(6);
    await expect(nodeById(page, "file:acesso.py").locator(".node")).toHaveClass(
      /\bon\b/,
    );
    await expect(backCircle(page)).toHaveCount(0);
  });

  test("an inner function level gets a back circle too", async ({ page }) => {
    await openApp(page);
    await clickCard(page, "file:acesso.py");
    await clickCard(page, "file:acesso.py/fn:pode_acessar");
    await expect(hub(page)).toHaveAttribute(
      "data-id",
      "file:acesso.py/fn:pode_acessar",
    );
    await backCircle(page).click();
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "app",
      "acesso.py",
    ]);
  });

  test("a card that opens shows how many nodes its level has, the same number its hub shows once open", async ({
    page,
  }) => {
    await openApp(page);
    // acesso.py hides its docstring and constants: 2, not 3.
    await expect(
      nodeById(page, "file:acesso.py").getByTitle("2 nós"),
    ).toHaveText("2");
    await clickCard(page, "file:acesso.py");
    await expect(hub(page).getByTitle("2 nós")).toHaveText("2");
    // pode_acessar has two steps; the steps carry no number.
    await expect(
      nodeById(page, "file:acesso.py/fn:pode_acessar").getByTitle("2 nós"),
    ).toHaveText("2");
    await clickCard(page, "file:acesso.py/fn:pode_acessar");
    await expect(hub(page).getByTitle("2 nós")).toHaveText("2");
    await expect(children(page).locator(".hub-count")).toHaveCount(0);
  });

  test("loose code that runs a call stays a card, tagged CÓDIGO SOLTO", async ({
    page,
  }) => {
    await openApp(page);
    await clickCard(page, "file:boot.py");
    await expect(children(page)).toHaveCount(1);
    await expect(children(page).locator(".tag")).toHaveText("CÓDIGO SOLTO");
  });
});
