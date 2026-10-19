import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "./test";

// G13: a file of 3000 functions in a chain (`f{i}` calls `f{i-1}`) overflowed dagre's
// recursion and left the screen blank. The level now comes as a grid of cards.

let tmp = "";
let APP = "";

test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "8n8-nivel-grande-"));
  APP = join(tmp, "app");
  mkdirSync(APP, { recursive: true });
  let text = "";
  for (let i = 0; i < 3000; i++) {
    text += `export function f${i}(x: number): number {\n  return ${i ? `f${i - 1}(x - 1)` : "x"};\n}\n\n`;
  }
  writeFileSync(join(APP, "chain.ts"), text);
});

test.afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const cards = (page: Page) =>
  page
    .getByRole("application")
    .locator('[aria-roledescription="node"]:not(.hub-node)');

test.describe("Nível grande", () => {
  test.setTimeout(120_000);

  test("G13: a file of 3000 chained functions opens as a grid of cards, with no blank screen and no error", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.getByLabel("Caminho da pasta").fill(APP);
    await page.getByRole("button", { name: "Mapear pasta" }).click();
    const file = page
      .getByRole("application")
      .locator('[aria-roledescription="node"][data-id="file:chain.ts"]');
    await expect(file).toBeVisible({ timeout: 30_000 });
    await file.dispatchEvent("click");

    // React Flow draws 6000 cards and wires: slow, but the level shows.
    await expect(
      page
        .getByRole("application")
        .locator(
          '[aria-roledescription="node"][data-id="file:chain.ts/fn:f0"]',
        ),
    ).toBeVisible({ timeout: 90_000 });
    await expect(
      page.getByRole("navigation", { name: "Caminho de navegação" }),
    ).toContainText("chain.ts");
    expect(await cards(page).count()).toBeGreaterThan(1000);
    await expect(
      page.getByText("Não deu para desenhar este nível."),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
