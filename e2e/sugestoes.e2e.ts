import { expect, type Page, test } from "@playwright/test";
import {
  backButton,
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

// Feature 05, story P3 (VID-31..33): the suggestions of an opened node show as
// light cards on the canvas, pinned to the visible node whose lines hold the
// suggestion's line. Keyed server (4319), fake LLM.

const SALVAR = `${PEDIDO}/s5`;
const EMAIL = `${PEDIDO}/s6`;
const TRANSACAO = "Grave o pedido numa transação";
const FILA = "Envie o e-mail por uma fila";

const alert = (page: Page, text: string) =>
  page.locator("button.alert", { hasText: text });

/** The video map with titles, then the GATILHO opened with its summary. */
async function openTrigger(page: Page): Promise<void> {
  await generate(page, REAL, VIDEO);
  await expectLevel(page, MAIN_FLOW);
  await expect.poll(() => cardNames(page)).toContain("Pedido recebido");
  await clickCard(page, PEDIDO);
  await expectLevel(page, [...MAIN_FLOW.slice(1), `${PEDIDO}/s7`]);
  await expect(alert(page, FILA)).toBeVisible();
}

/** The card sits just above its anchor node, over its left part. */
async function expectAbove(page: Page, text: string, anchor: string) {
  await expect
    .poll(async () => {
      const a = await box(alert(page, text));
      const n = await box(cardOf(page, anchor));
      return [
        a.y + a.height <= n.y + 1,
        n.y - (a.y + a.height) < 60,
        a.x >= n.x && a.x <= n.x + n.width / 2,
      ];
    })
    .toEqual([true, true, true]);
}

test.beforeEach(freshReal);

test("VID-31, IT P3: the GATILHO's suggestions pin to BANCO and E-MAIL, inside and back on the main flow", async ({
  page,
}) => {
  await openTrigger(page);
  await expect(page.locator("button.alert")).toHaveText([TRANSACAO, FILA]);
  await expect(alert(page, TRANSACAO)).toHaveAttribute(
    "data-anchor-id",
    SALVAR,
  );
  await expect(alert(page, FILA)).toHaveAttribute("data-anchor-id", EMAIL);
  expect(await css(alert(page, FILA), "background-color")).toBe(SECOND);
  expect(await css(alert(page, FILA), "color")).toBe(GROUND);
  expect(await cardOf(page, SALVAR).getAttribute("data-tag")).toBe("BANCO");
  expect(await cardOf(page, EMAIL).getAttribute("data-tag")).toBe("E-MAIL");
  await expectAbove(page, TRANSACAO, SALVAR);
  await expectAbove(page, FILA, EMAIL);

  await backButton(page).click();
  await expectLevel(page, MAIN_FLOW);
  await expect(page.locator("button.alert")).toHaveText([TRANSACAO, FILA]);
  await expect(alert(page, TRANSACAO)).toHaveAttribute(
    "data-anchor-id",
    SALVAR,
  );
  await expect(alert(page, FILA)).toHaveAttribute("data-anchor-id", EMAIL);
  await expectAbove(page, TRANSACAO, SALVAR);
  await expectAbove(page, FILA, EMAIL);
});

test("VID-32: nodes with a card get the Petróleo border; the others show at 55% opacity", async ({
  page,
}) => {
  await openTrigger(page);
  const level = await nodes(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-id") ?? ""),
  );
  for (const id of level) {
    const card = cardOf(page, id);
    if (id === SALVAR || id === EMAIL) {
      expect(await css(card, "border-top-color")).toBe(MAIN);
      await expect.poll(() => css(card, "opacity")).toBe("1");
    } else {
      expect(await css(card, "border-top-color")).not.toBe(MAIN);
      await expect.poll(() => css(card, "opacity")).toBe("0.55");
    }
  }
});

test("VID-33: clicking a suggestion card opens the node's panel with the suggestion's line marked", async ({
  page,
}) => {
  await openTrigger(page);
  // Move the panel away from processar_pedido first.
  await clickCard(page, `${PEDIDO}/s1`);
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(
    "Validar pedido",
  );
  await alert(page, FILA).click();
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
