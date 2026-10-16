import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { box, canvas, generate, nodeById, nodes, OFFLINE } from "./mapa";

// VID-21: the "true" and "false" labels of an `if` stay apart and clear of
// every card, whether the `if` has an `else` or only raises.
const RAISES =
  'def frete(peso, distancia):\n    if peso <= 0:\n        raise ValueError("peso")\n    return (10 + peso * 0.5) * (1.2 if distancia > 500 else 1.0)\n';
const ELSE =
  'def desconto(preco, cupom):\n    if cupom == "VIP":\n        total = preco * 0.8\n    else:\n        total = preco\n    return total\n';

type Rect = { x: number; y: number; width: number; height: number };
const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

async function rects(all: Locator): Promise<Rect[]> {
  const out: Rect[] = [];
  for (let i = 0; i < (await all.count()); i++) out.push(await box(all.nth(i)));
  return out;
}

// The card each branch leads to: its label stands by that card's port.
const TARGETS = {
  [RAISES]: { true: "fn:frete/s0/b0/s0", false: "fn:frete/s1" },
  [ELSE]: { true: "fn:desconto/s0/b0/s0", false: "fn:desconto/s0/b1/s0" },
} as const;

for (const [name, source] of [
  ["an if that only raises", RAISES],
  ["an if with an else", ELSE],
] as const) {
  test(`VID-21: the branch labels of ${name} stand by their own cards, apart and clear of every card`, async ({
    page,
  }) => {
    await generate(page, OFFLINE, source);
    // The function is the only card of the main flow: one click opens it.
    await nodes(page).first().dispatchEvent("click");
    const labels = canvas(page).locator("[data-branch-label]");
    await expect(labels).toHaveText(["true", "false"]);
    // The wires draw in: wait until the cards stop moving.
    await page.waitForTimeout(1500);
    const [a, b] = await rects(labels);
    expect(a && b && overlap(a, b)).toBe(false);
    const cards = await rects(canvas(page).locator(".node"));
    for (const label of [a, b]) {
      for (const card of cards) {
        expect(label && overlap(label, card)).toBe(false);
      }
    }
    // Each label stands by its own card (VID-21): it ends just left of the
    // card, by the height of the card's middle; or, when its wire turns down
    // into a later band, it sits just above the card's top-left corner.
    for (const branch of ["true", "false"] as const) {
      const label = await box(
        canvas(page).locator(`[data-branch-label="${branch}"]`),
      );
      const card = await box(nodeById(page, TARGETS[source][branch]));
      const gap = card.x - (label.x + label.width);
      const port = card.y + card.height / 2;
      const byPort =
        gap >= 0 &&
        gap < 16 &&
        Math.abs(label.y + label.height / 2 - port) < label.height;
      const rise = card.y - (label.y + label.height);
      const onTop = rise >= 0 && rise < 16 && Math.abs(label.x - card.x) < 16;
      expect(byPort || onTop).toBe(true);
    }
  });
}

// A branch whose wire turns into the next band of a wrapped level comes down
// just left of its card: the label must stay on the canvas, clear of the cards
// and of every wire.
const ORDERS = readFileSync(
  fileURLToPath(
    new URL("../docs/sample-project/store/orders.py", import.meta.url),
  ),
  "utf8",
);

/** Points along every wire of the level, in screen coordinates. */
async function wirePoints(page: Page): Promise<{ x: number; y: number }[]> {
  return canvas(page)
    .locator("path.wire")
    .evaluateAll((paths) =>
      paths.flatMap((el) => {
        const path = el as SVGPathElement;
        const m = path.getScreenCTM();
        if (!m) return [];
        const length = path.getTotalLength();
        const out: { x: number; y: number }[] = [];
        for (let at = 0; at <= length; at += 2) {
          const p = path.getPointAtLength(at);
          out.push({
            x: m.a * p.x + m.c * p.y + m.e,
            y: m.b * p.x + m.d * p.y + m.f,
          });
        }
        return out;
      }),
    );
}

for (const [name, source, fn] of [
  ["an if that only raises", RAISES, "fn:frete"],
  ["the sample orders.py", ORDERS, "fn:process_order"],
] as const) {
  test(`the branch labels of ${name}, in a wrapped level, stay on the canvas, clear of every card and wire`, async ({
    page,
  }) => {
    await generate(page, OFFLINE, source);
    await nodeById(page, fn).dispatchEvent("click");
    const labels = canvas(page).locator("[data-branch-label]");
    await expect(labels).toHaveCount(2);
    // The wires draw in: wait until they are complete.
    await page.waitForTimeout(2500);
    const area = await box(canvas(page));
    const cards = await rects(canvas(page).locator(".node"));
    const points = await wirePoints(page);
    for (const label of await rects(labels)) {
      expect(label.x).toBeGreaterThanOrEqual(area.x);
      expect(label.x + label.width).toBeLessThanOrEqual(area.x + area.width);
      for (const card of cards) expect(overlap(label, card)).toBe(false);
      const crossed = points.filter(
        (p) =>
          p.x > label.x &&
          p.x < label.x + label.width &&
          p.y > label.y &&
          p.y < label.y + label.height,
      );
      expect(crossed).toEqual([]);
    }
  });
}
