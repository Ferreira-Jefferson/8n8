import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { css, generate, LIME, nodes } from "./mapa";

// The search history, end to end: a keyless server of its own on 4321 (playwright.config.ts),
// a persistent SQLite file. Every test starts by wiping it through the DELETE API.
const HISTORY = "http://127.0.0.1:4321";
test.use({ baseURL: HISTORY });

const FIXTURE = fileURLToPath(
  new URL(
    "../packages/extract-python/src/__tests__/fixtures/projeto-loja",
    import.meta.url,
  ),
);

let tmp = "";
let LOJA = "";

test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "code2n8n-historico-"));
  LOJA = join(tmp, "loja");
  cpSync(FIXTURE, LOJA, { recursive: true });
});

test.afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

interface Item {
  id: number;
  title: string;
  kind: string;
  openCount?: number;
}

async function list(page: Page): Promise<Item[]> {
  const res = await page.request.get(`${HISTORY}/api/history`);
  return ((await res.json()) as { items: Item[] }).items;
}

/** Waits for the best-effort save (setImmediate) and returns the rows. */
async function saved(page: Page, count: number): Promise<Item[]> {
  await expect.poll(async () => (await list(page)).length).toBe(count);
  return list(page);
}

test.beforeEach(async ({ page }) => {
  for (const item of await list(page)) {
    await page.request.delete(`${HISTORY}/api/history/${item.id}`);
  }
  expect(await list(page)).toEqual([]);
});

const snippet = (name: string) =>
  `def ${name}(x):\n    return x + 1\n\ndef principal():\n    return ${name}(1)\n`;

/** The hamburger on the map and the editor; "Ver todo o histórico" on the launcher. */
const toggle = (page: Page) =>
  page.getByRole("button", { name: /^(Histórico|Ver todo o histórico)$/ });
const drawer = (page: Page) =>
  page.getByRole("complementary", { name: "Histórico" });
const rows = (page: Page) => drawer(page).locator("li");

async function openFolder(page: Page, path: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Caminho da pasta").fill(path);
  const response = page.waitForResponse("**/api/project");
  await page.getByRole("button", { name: "Mapear pasta" }).click();
  await response;
}

const levelIds = (page: Page) =>
  nodes(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));

test.describe("Histórico", () => {
  test("the drawer is empty at first, on the launcher", async ({ page }) => {
    await page.goto("/");
    await toggle(page).click();
    await expect(drawer(page)).toBeVisible();
    await expect(
      drawer(page).getByText("Nenhuma pesquisa guardada."),
    ).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
  });

  test("a snippet appears in the drawer on the map and on the editor screen, with title, tag and sizes", async ({
    page,
  }) => {
    await generate(page, HISTORY, snippet("alfa_unico"));
    const [item] = await saved(page, 1);
    if (!item) throw new Error("no row");
    expect(item.kind).toBe("snippet");

    await toggle(page).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(item.title);
    await expect(rows(page).first()).toContainText("TRECHO");
    await expect(rows(page).first()).toContainText(
      /\d+ linhas? · \d+ arquivos? · \d+ nós? · \d+ (B|KB)/,
    );
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();

    await page.getByRole("button", { name: "Novo código" }).click();
    await expect(page.getByLabel("Trecho Python")).toBeVisible();
    await toggle(page).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(item.title);
  });

  test("the saved row survives a page reload", async ({ page }) => {
    await generate(page, HISTORY, snippet("beta_unico"));
    const [item] = await saved(page, 1);
    await page.reload();
    await toggle(page).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(item?.title ?? "never");
  });

  test("reopening a row shows the same cards and calls neither /api/graph nor /api/project", async ({
    page,
  }) => {
    await generate(page, HISTORY, snippet("gama_unico"));
    await expect(nodes(page).first()).toBeVisible();
    const before = await levelIds(page);
    expect(before.length).toBeGreaterThan(0);
    await saved(page, 1);

    await page.reload();
    const calls: string[] = [];
    await page.route(/\/api\/(graph|project)(\?|$)/, (route) => {
      calls.push(route.request().url());
      return route.continue();
    });
    await toggle(page).click();
    const entry = page.waitForResponse(/\/api\/history\/\d+$/);
    await rows(page).first().locator(".history-open").click();
    await entry;

    await expect(nodes(page).first()).toBeVisible();
    await expect.poll(() => levelIds(page)).toEqual(before);
    expect(calls).toEqual([]);
  });

  test("the same code generated twice leaves one row", async ({ page }) => {
    const code = snippet("delta_unico");
    await generate(page, HISTORY, code);
    const [first] = await saved(page, 1);
    await generate(page, HISTORY, code);
    await expect
      .poll(async () => (await list(page))[0]?.openCount)
      .toBeGreaterThan(first?.openCount ?? 0);
    expect(await list(page)).toHaveLength(1);

    await toggle(page).click();
    await expect(rows(page)).toHaveCount(1);
  });

  test("a folder map appears as PASTA with the green tag", async ({ page }) => {
    await openFolder(page, LOJA);
    const [item] = await saved(page, 1);
    expect(item?.kind).toBe("project");

    await toggle(page).click();
    await expect(rows(page)).toHaveCount(1);
    const tag = rows(page).first().locator(".history-tag");
    await expect(tag).toHaveText("PASTA");
    expect(await css(tag, "color")).toBe(LIME);
  });

  test("the search filters the rows and says when nothing matches", async ({
    page,
  }) => {
    await generate(page, HISTORY, snippet("pesquisa_um"));
    await saved(page, 1);
    await generate(page, HISTORY, snippet("pesquisa_dois"));
    const items = await saved(page, 2);

    await toggle(page).click();
    await expect(rows(page)).toHaveCount(2);
    const target = items[0]?.title ?? "";
    const expected = items.filter((i) =>
      i.title.toLowerCase().includes(target.toLowerCase()),
    ).length;
    const search = drawer(page).getByLabel("Buscar no histórico");
    await search.fill(target);
    await expect(rows(page)).toHaveCount(expected);
    await expect(rows(page).first()).toContainText(target);

    await search.fill("zzz-nao-existe-zzz");
    await expect(rows(page)).toHaveCount(0);
    await expect(drawer(page).getByText("Nada encontrado.")).toBeVisible();
  });

  test("delete removes the row and it stays gone after a reload", async ({
    page,
  }) => {
    await generate(page, HISTORY, snippet("apagar_um"));
    await saved(page, 1);
    await generate(page, HISTORY, snippet("apagar_dois"));
    const items = await saved(page, 2);
    const gone = items[0];
    if (!gone) throw new Error("no row");

    await toggle(page).click();
    await expect(rows(page)).toHaveCount(2);
    await drawer(page)
      .getByRole("button", { name: `Apagar ${gone.title}` })
      .first()
      .click();
    await expect(rows(page)).toHaveCount(1);
    expect((await list(page)).map((i) => i.id)).not.toContain(gone.id);

    await page.reload();
    await toggle(page).click();
    await expect(rows(page)).toHaveCount(1);

    const last = (await list(page))[0];
    await drawer(page)
      .getByRole("button", { name: `Apagar ${last?.title}` })
      .click();
    await expect(
      drawer(page).getByText("Nenhuma pesquisa guardada."),
    ).toBeVisible();
  });

  test("Esc and a click outside close the drawer", async ({ page }) => {
    await generate(page, HISTORY, snippet("fecha_unico"));
    await saved(page, 1);

    await toggle(page).click();
    await expect(drawer(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();

    await toggle(page).click();
    await expect(drawer(page)).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(drawer(page)).toBeHidden();
  });

  test("the launcher: a mapped folder shows under Recentes, its star moves it to Favoritos, and it stays there after a reload", async ({
    page,
  }) => {
    await openFolder(page, LOJA);
    await expect(nodes(page).first()).toBeVisible();
    const before = await levelIds(page);
    await saved(page, 1);
    await page.getByRole("button", { name: "Novo código" }).click();

    const recent = page.getByRole("region", { name: "Recentes" });
    const favorites = page.getByRole("region", { name: "Favoritos" });
    await expect(recent.getByRole("listitem")).toHaveCount(1);
    await expect(recent).toContainText("loja");
    await expect(recent).toContainText(LOJA);
    await expect(favorites).toHaveCount(0);

    await recent
      .getByRole("button", { name: "Pôr loja nos favoritos" })
      .click();
    await expect(favorites.getByRole("listitem")).toHaveCount(1);
    await expect(recent).toHaveCount(0);
    await expect
      .poll(async () => (await list(page))[0])
      .toMatchObject({ title: "loja", starred: true });

    await page.reload();
    const star = favorites.getByRole("button", {
      name: "Tirar loja dos favoritos",
    });
    await expect(star).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: "test-results/tela-inicial.png" });

    await favorites.getByRole("button", { name: /^loja/ }).click();
    await expect.poll(() => levelIds(page)).toEqual(before);
  });

  test("a star set in the drawer shows on the launcher when the drawer closes", async ({
    page,
  }) => {
    await generate(page, HISTORY, snippet("gama_unico"));
    const [item] = await saved(page, 1);
    if (!item) throw new Error("no row");
    await page.goto("/");
    await toggle(page).click();
    await rows(page)
      .first()
      .getByRole("button", { name: `Pôr ${item.title} nos favoritos` })
      .click();
    await expect(
      rows(page)
        .first()
        .getByRole("button", { name: `Tirar ${item.title} dos favoritos` }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();
    await expect(
      page.getByRole("region", { name: "Favoritos" }).getByRole("listitem"),
    ).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Recentes" })).toHaveCount(0);
  });
});
