import { expect, type Locator, test } from "@playwright/test";
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
    // Each label stands by the port of its own card: it ends just left of
    // the card, by the height of the card's middle (VID-21).
    for (const branch of ["true", "false"] as const) {
      const label = await box(
        canvas(page).locator(`[data-branch-label="${branch}"]`),
      );
      const card = await box(nodeById(page, TARGETS[source][branch]));
      const gap = card.x - (label.x + label.width);
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThan(16);
      const port = card.y + card.height / 2;
      expect(Math.abs(label.y + label.height / 2 - port)).toBeLessThan(
        label.height,
      );
    }
  });
}
