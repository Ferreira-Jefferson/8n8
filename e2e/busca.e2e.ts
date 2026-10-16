import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import {
  box,
  breadcrumb,
  canvas,
  cardOf,
  centre,
  css,
  expectLevel,
  FRETE,
  freshReal,
  generate,
  MAIN,
  MAIN_FLOW,
  PEDIDO,
  REAL,
  VIDEO,
} from "./mapa";

// Feature 14, node search: a magnifier at the top right that grows into a field,
// finds a node by its title or by its technical name, and goes to it at any level.

const FIXTURE = fileURLToPath(
  new URL(
    "../packages/languages/python/src/__tests__/fixtures/projeto-loja",
    import.meta.url,
  ),
);
let tmp = "";
let LOJA = "";

test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "8n8-busca-"));
  LOJA = join(tmp, "loja");
  cpSync(FIXTURE, LOJA, { recursive: true });
});

test.afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const CALCULAR = "file:frete/calculo.py/fn:calcular_frete";

const lupa = (page: Page) => page.getByRole("button", { name: "Buscar nó" });
const field = (page: Page) => page.getByRole("combobox", { name: "Buscar nó" });
const options = (page: Page) => page.getByRole("option");

async function openLoja(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Caminho da pasta").fill(LOJA);
  await page.getByRole("button", { name: "Mapear pasta" }).click();
  await expect(page.getByRole("application")).toBeVisible();
  await expect(lupa(page)).toBeVisible();
}

/** The card is selected (Petróleo border) and inside the visible canvas. */
async function expectSelectedInView(page: Page, id: string): Promise<void> {
  await expect(cardOf(page, id)).toHaveClass(/\bon\b/);
  expect(await css(cardOf(page, id), "border-top-color")).toBe(MAIN);
  await expect
    .poll(async () => {
      const c = await box(canvas(page));
      const b = await box(cardOf(page, id));
      return (
        b.x >= c.x - 1 &&
        b.y >= c.y - 1 &&
        b.x + b.width <= c.x + c.width + 1 &&
        b.y + b.height <= c.y + c.height + 1
      );
    })
    .toBe(true);
}

test.describe("Busca de nó", () => {
  test("BUSCA-01/02: a closed search is only a magnifier, left of Configurações, and it grows into the field", async ({
    page,
  }) => {
    await openLoja(page);
    await expect(field(page)).toBeHidden();
    const settings = page.getByRole("button", { name: "Configurações" });
    const history = page.getByRole("button", { name: "Histórico" });
    const closed = await box(page.locator(".search-field"));
    expect([closed.width, closed.height]).toEqual([60, 60]);
    expect(closed.x + closed.width).toBeLessThanOrEqual(
      (await box(settings)).x,
    );
    expect((await box(settings)).x + 60).toBeLessThanOrEqual(
      (await box(history)).x,
    );
    expect(closed.y).toBe((await box(settings)).y);

    await lupa(page).click();
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveAttribute(
      "placeholder",
      "Título ou nome da função",
    );
    // The field grows to the left: the magnifier stays on the right edge.
    await expect
      .poll(async () => (await box(page.locator(".search-field"))).width)
      .toBeGreaterThan(300);
    const open = await box(page.locator(".search-field"));
    expect(open.x + open.width).toBeCloseTo(closed.x + closed.width, 0);
    await expect(page.locator(".search-field")).toHaveCSS(
      "transition-duration",
      /0\.2s/,
    );
  });

  test("BUSCA-02: Esc and a click outside close the search and clear the field", async ({
    page,
  }) => {
    await openLoja(page);
    await lupa(page).click();
    await field(page).fill("frete");
    await page.keyboard.press("Escape");
    await expect(field(page)).toBeHidden();
    await expect(page.getByRole("application")).toBeVisible();
    // Esc did not leave the level: it only closed the search.
    await expect(breadcrumb(page).getByRole("button")).toHaveCount(1);

    await lupa(page).click();
    await expect(field(page)).toHaveValue("");
    await page.getByRole("application").click({ position: { x: 5, y: 300 } });
    await expect(field(page)).toBeHidden();
  });

  test("BUSCA-02: with reduced motion the field opens with no animation", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openLoja(page);
    await expect(page.locator(".search-field")).toHaveCSS(
      "transition-duration",
      "0s",
    );
    await lupa(page).click();
    await expect(field(page)).toBeFocused();
    expect((await box(page.locator(".search-field"))).width).toBeGreaterThan(
      300,
    );
  });

  test("BUSCA-03/04: it finds by the technical name across accents and _, with the match marked and the file and lines shown", async ({
    page,
  }) => {
    await openLoja(page);
    await lupa(page).click();
    await field(page).fill("CALCULAR frete");
    // The fixture has calcular_frete twice (frete/ and legado/): the file tells them apart.
    await expect(options(page)).toHaveCount(2);
    const result = options(page).filter({ hasText: "calculo.py" });
    await expect(result.locator("b")).toHaveText("Calcular frete");
    await expect(result.locator("em")).toHaveText("calcular_frete()");
    await expect(result.locator("i")).toHaveText(/^calculo\.py · \d+–\d+$/);
    await expect(result.locator("mark")).toHaveText([
      "Calcular",
      "frete",
      "calcular",
      "frete",
    ]);
    await field(page).fill("zzz");
    await expect(options(page)).toHaveCount(0);
    await expect(page.getByText("Nenhum nó achado.")).toBeVisible();
  });

  test("BUSCA-04: the arrows move the highlight and Enter picks it", async ({
    page,
  }) => {
    await openLoja(page);
    await lupa(page).click();
    await field(page).fill("frete");
    expect(await options(page).count()).toBeGreaterThan(1);
    await page.keyboard.press("ArrowDown");
    await expect(options(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(options(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(field(page)).toHaveAttribute(
      "aria-activedescendant",
      (await options(page).nth(0).getAttribute("id")) ?? "",
    );
  });

  test("BUSCA-05: a function two levels down opens the path to it, selects it and shows it", async ({
    page,
  }) => {
    await openLoja(page);
    await lupa(page).click();
    await field(page).fill("calcular_frete");
    await options(page).filter({ hasText: "calculo.py" }).click();
    await expect(field(page)).toBeHidden();
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "loja",
      "frete",
      "calculo.py",
    ]);
    await expectSelectedInView(page, CALCULAR);
  });

  test("BUSCA-05: a node of the open level is selected and kept in view", async ({
    page,
  }) => {
    await openLoja(page);
    await lupa(page).click();
    await field(page).fill("relatorio");
    await options(page).filter({ hasText: "relatorio.py" }).first().click();
    await expect(breadcrumb(page).getByRole("button")).toHaveCount(1);
    await expectSelectedInView(page, "file:relatorio.py");
  });

  test("BUSCA-05: a search from a deep level goes up to a node of a higher one", async ({
    page,
  }) => {
    await openLoja(page);
    await lupa(page).click();
    await field(page).fill("calcular_frete");
    await options(page).filter({ hasText: "calculo.py" }).click();
    await expectSelectedInView(page, CALCULAR);
    await lupa(page).click();
    await field(page).fill("pedidos/");
    await options(page)
      .filter({ has: page.locator("em", { hasText: /^pedidos\/$/ }) })
      .click();
    await expect(breadcrumb(page).getByRole("button")).toHaveCount(1);
    await expectSelectedInView(page, "dir:pedidos");
  });

  test("BUSCA-06: a pick from the open level centers the card at the current zoom", async ({
    page,
  }) => {
    await openLoja(page);
    await lupa(page).click();
    await field(page).fill("relatorio");
    await options(page).filter({ hasText: "relatorio.py" }).first().click();
    await expectSelectedInView(page, "file:relatorio.py");
    // The panel is open now, so the canvas keeps its size: only the search moves the view.
    await lupa(page).click();
    await field(page).fill("main.py");
    await options(page).first().click();
    await expect(cardOf(page, "file:main.py")).toHaveClass(/\bon\b/);
    await expect
      .poll(async () => {
        const c = await box(canvas(page));
        const v = centre(await box(cardOf(page, "file:main.py")));
        return Math.hypot(
          v.x - (c.x + c.width / 2),
          v.y - (c.y + c.height / 2),
        );
      })
      .toBeLessThan(10);
  });
});

test.describe("Busca de nó, com títulos revisados", () => {
  test.beforeEach(freshReal);

  test("BUSCA-03: it finds the same node by the reviewed title and by the technical name", async ({
    page,
  }) => {
    await generate(page, REAL, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    // The LLM titled the entry "Pedido recebido"; its code name is processar_pedido.
    await expect(cardOf(page, PEDIDO).locator(".name")).toContainText(
      "Pedido recebido",
    );
    await lupa(page).click();
    await field(page).fill("pedido recebido");
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).first().locator("b")).toHaveText(
      "Pedido recebido",
    );
    await expect(options(page).first().locator("em")).toHaveText(
      "processar_pedido()",
    );
    await field(page).fill("processar_pedido");
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).first().locator("b")).toHaveText(
      "Pedido recebido",
    );
    await expect(options(page).first().locator("em mark")).toHaveText([
      "processar",
      "pedido",
    ]);
  });

  test("BUSCA-05: a function the main flow shows is marked there, with no change of level", async ({
    page,
  }) => {
    await generate(page, REAL, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    // calcular_frete is a card of the main flow (VID-11): the level stays.
    await lupa(page).click();
    await field(page).fill("calcular_frete");
    await page.keyboard.press("Enter");
    await expectLevel(page, MAIN_FLOW);
    await expect(breadcrumb(page).getByRole("button")).toHaveCount(1);
    await expect(
      page.locator(`[data-id="${FRETE}"]`).locator(".node"),
    ).toHaveClass(/\bon\b/);
  });
});
