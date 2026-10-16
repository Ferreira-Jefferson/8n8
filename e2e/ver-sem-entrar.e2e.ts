import { expect, test } from "@playwright/test";
import {
  clickCard,
  expectLevel,
  freshReal,
  generate,
  MAIN_FLOW,
  nodeById,
  PEDIDO,
  panel,
  REAL,
  VIDEO,
} from "./mapa";

// A card that opens shows its panel (code, summary, suggestions) through a
// button, without entering the node. A click on the card still enters.

const FRETE_CARD = `${PEDIDO}/s3`;
const inspect = (page: Parameters<typeof nodeById>[0]) =>
  nodeById(page, FRETE_CARD).getByRole("button", {
    name: "Ver detalhes do nó",
  });

test.beforeEach(freshReal);

test("the inspect button opens the panel and stays on the same level", async ({
  page,
}) => {
  await generate(page, REAL, VIDEO);
  await expectLevel(page, MAIN_FLOW);
  await expect(panel(page)).toHaveCount(0);

  await inspect(page).click();

  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator("pre")).toContainText("calcular_frete");
  await expectLevel(page, MAIN_FLOW);
});

test("a click on the card itself still enters the node", async ({ page }) => {
  await generate(page, REAL, VIDEO);
  await expectLevel(page, MAIN_FLOW);
  await clickCard(page, FRETE_CARD);
  await expect(nodeById(page, `${FRETE_CARD}`)).toHaveCount(0);
});

test("a card that does not open has no inspect button", async ({ page }) => {
  await generate(page, REAL, VIDEO);
  await expectLevel(page, MAIN_FLOW);
  await expect(
    nodeById(page, `${PEDIDO}/s0`).getByRole("button", {
      name: "Ver detalhes do nó",
    }),
  ).toHaveCount(0);
});
