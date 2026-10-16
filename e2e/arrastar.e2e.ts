import {
  box,
  cardOf,
  clickCard,
  edges,
  expectLevel,
  FRETE,
  FRETE_LEVEL,
  generate,
  MAIN_FLOW,
  nodeById,
  OFFLINE,
  PEDIDO,
  panel,
  VIDEO,
} from "./mapa";
import { expect, type Page, test } from "./test";

// The viewer can drag a card to a new place; its wires follow it, and two
// wires that share a gap never run together.

const SE = `${FRETE}/s2`;

async function openFrete(page: Page): Promise<void> {
  await generate(page, OFFLINE, VIDEO);
  await expectLevel(page, MAIN_FLOW);
  await clickCard(page, `${PEDIDO}/s3`);
  await expectLevel(page, FRETE_LEVEL);
}

/** Drags the card by its tag line `dx`, `dy` px. */
async function dragCard(
  page: Page,
  id: string,
  dx: number,
  dy: number,
): Promise<void> {
  const b = await box(cardOf(page, id));
  const x = b.x + b.width / 2;
  const y = b.y + 24;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

/** Screen point of each wire's start, and the centre of each out port. */
async function wireStarts(page: Page) {
  return edges(page).evaluateAll((els) =>
    els.map((el) => {
      const path = el.querySelector<SVGPathElement>("path.wire");
      const m = path?.getScreenCTM();
      const p = path?.getPointAtLength(0);
      return m && p
        ? { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }
        : null;
    }),
  );
}

test.describe("dragging cards", () => {
  test("a dragged card stays where it is dropped", async ({ page }) => {
    await openFrete(page);
    const id = `${FRETE}/s1`;
    // Opening the call shows the panel of calcular_frete (VID-23); a drag is
    // not a click, so the panel stays on it and does not move to the card.
    const title = panel(page).getByRole("heading", { level: 2 });
    const opened = await title.textContent();
    const before = await box(nodeById(page, id));
    await dragCard(page, id, 0, 160);
    const after = await box(nodeById(page, id));
    expect(after.y - before.y).toBeGreaterThan(100);
    expect(Math.abs(after.x - before.x)).toBeLessThan(5);
    await expect(title).toHaveText(opened ?? "");
  });

  test("the wires keep their ports after a drag", async ({ page }) => {
    await openFrete(page);
    await dragCard(page, SE, 120, 140);
    const ports = await page.locator(".port-out").evaluateAll((els) =>
      els
        .filter((el) => getComputedStyle(el).visibility !== "hidden")
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }),
    );
    for (const s of await wireStarts(page)) {
      expect(s).not.toBeNull();
      const near = ports.some(
        (p) => Math.hypot(p.x - (s?.x ?? 0), p.y - (s?.y ?? 0)) < 6,
      );
      expect(near).toBe(true);
    }
  });

  test("a wire changes to the sides that face each other when its card is dragged", async ({
    page,
  }) => {
    await openFrete(page);
    const visible = (sel: string) =>
      page
        .locator(sel)
        .evaluateAll(
          (els) =>
            els.filter((el) => getComputedStyle(el).visibility !== "hidden")
              .length,
        );
    const vertical = ".port-top, .port-bottom";
    expect(await visible(vertical)).toBe(0);
    await dragCard(page, SE, 0, 600);
    expect(await visible(vertical)).toBeGreaterThan(0);
  });

  test("a moved card keeps its place after Esc and a new opening", async ({
    page,
  }) => {
    await openFrete(page);
    const id = `${FRETE}/s1`;
    await dragCard(page, id, 0, 160);
    const moved = await nodeById(page, id).getAttribute("style");
    await page.keyboard.press("Escape");
    await expectLevel(page, MAIN_FLOW);
    await clickCard(page, `${PEDIDO}/s3`);
    await expectLevel(page, FRETE_LEVEL);
    expect(await nodeById(page, id).getAttribute("style")).toBe(moved);
  });

  test("a new map starts from the automatic layout again", async ({ page }) => {
    await openFrete(page);
    const id = `${FRETE}/s1`;
    const style = await nodeById(page, id).getAttribute("style");
    await dragCard(page, id, 0, 160);
    await page.reload();
    await openFrete(page);
    expect(await nodeById(page, id).getAttribute("style")).toBe(style);
  });
});
