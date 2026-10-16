import { fileURLToPath } from "node:url";
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

test("in a folder map, a file card has the inspect button and a folder card does not", async ({
  page,
}) => {
  await page.goto(`${REAL}/`);
  await page
    .getByLabel("Caminho da pasta")
    .fill(
      fileURLToPath(new URL("../docs/sample-project/store", import.meta.url)),
    );
  await page.getByRole("button", { name: "Mapear pasta" }).click();
  const button = { name: "Ver detalhes do nó" };
  await expect(
    nodeById(page, "file:orders.py").getByRole("button", button),
  ).toHaveCount(1);
  await expect(
    nodeById(page, "dir:services").getByRole("button", button),
  ).toHaveCount(0);
  await nodeById(page, "file:orders.py").getByRole("button", button).click();
  await expect(panel(page).locator("pre")).toContainText("def process_order");
});

test("a folder never opens the panel: not on entering it, nor by its hub, the breadcrumb or the search", async ({
  page,
}) => {
  await page.goto(`${REAL}/`);
  await page
    .getByLabel("Caminho da pasta")
    .fill(
      fileURLToPath(new URL("../docs/sample-project/store", import.meta.url)),
    );
  await page.getByRole("button", { name: "Mapear pasta" }).click();
  const noPanel = async () => {
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator(".panel-toggle")).toHaveCount(0);
  };
  await clickCard(page, "dir:services");
  await expect(nodeById(page, "dir:services")).toBeVisible();
  await noPanel();
  await nodeById(page, "dir:services").dispatchEvent("click");
  await noPanel();
  await page
    .locator("nav.breadcrumb")
    .getByRole("button", { name: "services" })
    .click();
  await noPanel();
  await page.getByRole("button", { name: "Buscar nó" }).click();
  await page.getByRole("combobox", { name: "Buscar nó" }).fill("services");
  await page.getByRole("option").first().click();
  // The search goes to the folder's level and selects it: still no panel.
  await expect(nodeById(page, "dir:services")).toBeVisible();
  await noPanel();
  // A file of the folder still shows its code.
  await clickCard(page, "dir:services");
  await clickCard(page, "file:services/email.py");
  await expect(panel(page).locator("pre")).toBeVisible();
});

test("the inspect button explains a whole file without entering it: summary, effects and suggestions", async ({
  page,
}) => {
  await page.goto(`${REAL}/`);
  await page
    .getByLabel("Caminho da pasta")
    .fill(
      fileURLToPath(new URL("../docs/sample-project/store", import.meta.url)),
    );
  await page.getByRole("button", { name: "Mapear pasta" }).click();
  await nodeById(page, "file:orders.py")
    .getByRole("button", { name: "Ver detalhes do nó" })
    .click();
  const view = panel(page);
  await expect(view.getByRole("list", { name: "Resumo" })).toContainText(
    "O arquivo processa um pedido em",
  );
  await expect(view.getByText("Revisado", { exact: true })).toBeVisible();
  await expect(view).toContainText("requests.post");
  await expect(view.getByText("Nenhuma sugestão para este nó.")).toBeVisible();
  // Still on the folder level: the file was not entered.
  await expect(nodeById(page, "file:orders.py")).toBeVisible();
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
