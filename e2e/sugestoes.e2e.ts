import {
  box,
  cardNames,
  cardOf,
  clickCard,
  css,
  expectLevel,
  freshReal,
  GROUND,
  generate,
  MAIN,
  MAIN_FLOW,
  nodes,
  PEDIDO,
  panel,
  REAL,
  SECOND,
  VIDEO,
} from "./mapa";
import { expect, type Page, test } from "./test";

// Feature 05, story P3 (VID-31, 33): the suggestions of an opened node show as
// a badge on the visible node whose lines hold the suggestion's line; a click
// on the badge opens a balloon with the list. Keyed server (4319), fake LLM.

const SALVAR = `${PEDIDO}/s5`;
const EMAIL = `${PEDIDO}/s6`;
const TRANSACAO = "Grave o pedido numa transação";
const FILA = "Envie o e-mail por uma fila";

const badge = (page: Page, id: string) =>
  cardOf(page, id).locator(".step-badge");
const balloon = (page: Page) => page.locator(".suggestion-pop");
const item = (page: Page, text: string) =>
  balloon(page).locator(".pop-item", { hasText: text });

/** The video map with titles, then the entry opened with its summary. */
async function openTrigger(page: Page): Promise<void> {
  await generate(page, REAL, VIDEO);
  await expectLevel(page, MAIN_FLOW);
  await expect.poll(() => cardNames(page)).toContain("Pedido recebido");
  await clickCard(page, PEDIDO);
  await expectLevel(page, [...MAIN_FLOW.slice(1, -1), `${PEDIDO}/s7`]);
  await expect(badge(page, EMAIL)).toBeVisible();
}

/** The badges of the level, by node id. */
async function badgeCounts(page: Page): Promise<Record<string, string>> {
  const ids = await nodes(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-id") ?? ""),
  );
  const counts: Record<string, string> = {};
  for (const id of ids) {
    const b = badge(page, id);
    if ((await b.count()) > 0) counts[id] = (await b.textContent()) ?? "";
  }
  return counts;
}

test.beforeEach(freshReal);

test("VID-31: the entry's suggestions show as badges on BANCO and E-MAIL, inside and back on the main flow, with no card over the canvas", async ({
  page,
}) => {
  await openTrigger(page);
  await expect
    .poll(() => badgeCounts(page))
    .toEqual({
      [SALVAR]: "1",
      [EMAIL]: "1",
    });
  expect(await cardOf(page, SALVAR).getAttribute("data-tag")).toBe("BANCO");
  expect(await cardOf(page, EMAIL).getAttribute("data-tag")).toBe("E-MAIL");
  await expect(page.locator(".alert, .frame-cards")).toHaveCount(0);
  await expect(balloon(page)).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expectLevel(page, MAIN_FLOW);
  await expect
    .poll(() => badgeCounts(page))
    .toEqual({
      [SALVAR]: "1",
      [EMAIL]: "1",
    });
});

test("the badge is a filled Névoa rectangle on the right of the card, apart from the green rectangle of the node count", async ({
  page,
}) => {
  await openTrigger(page);
  const count = page.locator(".node .hub-count").first();
  await expect(count).toBeVisible();
  expect(await css(count, "background-color")).toBe(MAIN);
  expect(await css(count, "color")).toBe(GROUND);
  expect(await css(count, "border-radius")).toBe("5px");
  const b = badge(page, EMAIL);
  expect(await css(b, "background-color")).toBe(SECOND);
  expect(await css(b, "color")).toBe(GROUND);
  expect(await css(b, "border-radius")).toBe("5px");
  const n = await box(cardOf(page, EMAIL));
  const bb = await box(b);
  expect(bb.y).toBeGreaterThanOrEqual(n.y);
  expect(bb.y + bb.height).toBeLessThan(n.y + n.height / 2);
  expect(bb.x + bb.width).toBeLessThanOrEqual(n.x + n.width);
});

test("no node dims while there are suggestions; a badge click opens the balloon and draws its node with the Petróleo border", async ({
  page,
}) => {
  await openTrigger(page);
  const level = await nodes(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-id") ?? ""),
  );
  for (const id of level) {
    await expect.poll(() => css(cardOf(page, id), "opacity")).toBe("1");
  }
  await badge(page, EMAIL).click();
  await expect(balloon(page)).toBeVisible();
  await expect(balloon(page).locator(".pop-command")).toHaveText([
    `média ${FILA}`,
  ]);
  await expect(badge(page, EMAIL)).toHaveAttribute("aria-expanded", "true");
  expect(await css(cardOf(page, EMAIL), "border-top-color")).toBe(MAIN);
  expect(await css(cardOf(page, SALVAR), "border-top-color")).not.toBe(MAIN);

  // The arrow points at the badge: the balloon is centered on it.
  const p = await box(balloon(page));
  const b = await box(badge(page, EMAIL));
  expect(Math.abs(p.x + p.width / 2 - (b.x + b.width / 2))).toBeLessThan(2);

  // Opening the other badge closes the first balloon.
  await badge(page, SALVAR).click();
  await expect(balloon(page)).toHaveCount(1);
  await expect(balloon(page).locator(".pop-command")).toHaveText([
    `alta ${TRANSACAO}`,
  ]);
});

test("Esc closes only the balloon and keeps the level; a click on the canvas closes it too", async ({
  page,
}) => {
  await openTrigger(page);
  await badge(page, EMAIL).click();
  await expect(balloon(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(balloon(page)).toHaveCount(0);
  await expect(badge(page, EMAIL)).toBeFocused();
  await expectLevel(page, [...MAIN_FLOW.slice(1, -1), `${PEDIDO}/s7`]);

  await badge(page, EMAIL).click();
  await expect(balloon(page)).toBeVisible();
  await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
  await expect(balloon(page)).toHaveCount(0);
});

test("VID-33: clicking a suggestion in the balloon opens the node's panel with the suggestion's line marked", async ({
  page,
}) => {
  await openTrigger(page);
  // Move the panel away from processar_pedido first.
  await clickCard(page, `${PEDIDO}/s1`);
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(
    "Validar pedido",
  );
  await badge(page, EMAIL).click();
  await item(page, FILA).click();
  await expect(balloon(page)).toHaveCount(0);
  const view = panel(page);
  await expect(view.getByRole("heading", { level: 2 })).toHaveText(
    "Pedido recebido",
  );
  await expect(view.locator('[aria-current="true"]')).toHaveCount(1);
  await expect(view.locator('[aria-current="true"]')).toHaveAttribute(
    "data-line",
    "13",
  );
  await expect(view.locator('[aria-current="true"] code')).toHaveText(
    "    enviar_email(cliente.email, total)",
  );
});
