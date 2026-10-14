import { expect, type Page, test } from "@playwright/test";
import {
  box,
  clickCard,
  expectLevel,
  FRETE,
  FRETE_LEVEL,
  generate,
  MAIN_FLOW,
  OFFLINE,
  PEDIDO,
  panel,
  VIDEO,
} from "./mapa";

// The detail panel can be widened or narrowed by dragging the bar on its left
// edge; the width stays for the next map.

const resizer = (page: Page) =>
  page.getByRole("separator", { name: "Redimensionar painel" });

/** The video map, then the HTTP step inside calcular_frete, with its panel. */
async function selectStep(page: Page): Promise<void> {
  await generate(page, OFFLINE, VIDEO);
  await expectLevel(page, MAIN_FLOW);
  await clickCard(page, `${PEDIDO}/s3`);
  await expectLevel(page, FRETE_LEVEL);
  await clickCard(page, `${FRETE}/s0`);
  await expect(panel(page)).toBeVisible();
}

/** Drags the bar's centre `dx` px to the right (negative: to the left). */
async function drag(page: Page, dx: number): Promise<void> {
  const b = await box(resizer(page));
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y);
  await page.mouse.move(x + dx, y);
  await page.mouse.up();
}

test.describe("panel width", () => {
  test("dragging the bar to the left widens the panel, to the right narrows it", async ({
    page,
  }) => {
    await selectStep(page);
    const before = (await box(panel(page))).width;

    await drag(page, -200);
    await expect
      .poll(async () => (await box(panel(page))).width)
      .toBeCloseTo(before + 200, -1);

    await drag(page, 300);
    await expect
      .poll(async () => (await box(panel(page))).width)
      .toBeCloseTo(before - 100, -1);
  });

  test("never narrows the panel below 320 px or past 70% of the window", async ({
    page,
  }) => {
    await selectStep(page);
    const view = page.viewportSize();
    if (!view) throw new Error("no viewport");

    await drag(page, 2000);
    // The panel column is 320 px; the panel itself sits inside its 24 px margins.
    await expect(resizer(page)).toHaveAttribute("aria-valuenow", "320");

    await drag(page, -2000);
    await expect(resizer(page)).toHaveAttribute(
      "aria-valuenow",
      String(Math.round(view.width * 0.7)),
    );
  });

  test("the arrows resize the panel from the keyboard", async ({ page }) => {
    await selectStep(page);
    const before = (await box(panel(page))).width;
    await resizer(page).focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(async () => (await box(panel(page))).width)
      .toBeCloseTo(before + 48, -1);
  });

  test("the next map keeps the width the viewer dragged to", async ({
    page,
  }) => {
    await selectStep(page);
    await drag(page, -200);
    const dragged = (await box(panel(page))).width;

    await page.reload();
    await selectStep(page);
    await expect
      .poll(async () => (await box(panel(page))).width)
      .toBeCloseTo(dragged, 0);
  });

  test("the node's code shows in full, with no horizontal scroll", async ({
    page,
  }) => {
    await selectStep(page);
    await drag(page, 2000);
    const code = panel(page).locator(".code-view");
    const fits = await code.evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits).toBe(true);
    await page.screenshot({ path: "test-results/painel-estreito.png" });
  });
});
