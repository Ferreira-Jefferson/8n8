import { describe, expect, it } from "vitest";
import {
  layoutLR,
  layoutRows,
  NODE_WIDTH,
  wrapColumns,
  wrapRows,
} from "../layout";
import { projectLevel } from "../project-level";
import {
  chooseWrap,
  FIT_PAD,
  fitViewport,
  fitZoom,
  LEGIBLE_ZOOM,
  levelViewport,
  MIN_START_ZOOM,
  revealViewport,
  SIDE_PAD,
  startViewport,
  TOP_PAD,
  WRAP_PAD,
} from "../viewport";
import { videoGraph } from "./video-graph";

const row = (n: number) =>
  layoutRows([Array.from({ length: n }, (_, i) => `n${i}`)]);

describe("startViewport (VID-03, VID-10)", () => {
  it("never starts the 8-card main flow below 0.8, with the first card at the left edge", () => {
    const v = startViewport(row(8), 1600, 900);
    expect(MIN_START_ZOOM).toBe(0.8);
    expect(v.zoom).toBe(0.8);
    // The first card (x = 0) sits SIDE_PAD from the left.
    expect(v.x).toBe(SIDE_PAD);
  });

  it("keeps 0.8 and the first card on the left in an 800 px canvas, next to the panel", () => {
    const v = startViewport(row(8), 800, 900);
    expect(v.zoom).toBe(0.8);
    expect(v.x).toBe(SIDE_PAD);
  });

  it("centers a short level at zoom 1", () => {
    // Two cards: 320 + 60 + 320 = 700 wide, 140 + 90 = 230 tall.
    const v = startViewport(row(2), 1600, 900);
    expect(v.zoom).toBe(1);
    expect(v.x).toBe(SIDE_PAD + (1520 - 700) / 2);
    // The second card sits 90 px higher, so the level starts at y = -90.
    expect(v.y).toBe(TOP_PAD + (720 - 230) / 2 + 90);
  });

  it("fits a level a little too wide for zoom 1 at a zoom between 0.8 and 1", () => {
    // Four cards: 4 * 380 - 60 = 1460 wide; the free width is 1366 - 80 = 1286.
    const v = startViewport(row(4), 1366, 768);
    expect(v.zoom).toBeCloseTo(1286 / 1460);
    expect(v.x).toBeCloseTo(SIDE_PAD);
  });

  it("starts a tall level at its top, below the header", () => {
    const rows = layoutRows(Array.from({ length: 5 }, (_, r) => [`r${r}`]));
    const v = startViewport(rows, 1600, 900);
    expect(v.zoom).toBe(MIN_START_ZOOM);
    expect(v.y).toBe(TOP_PAD);
  });

  it("returns zoom 1 at the origin for an empty level", () => {
    expect(startViewport(new Map(), 1600, 900)).toEqual({
      x: 0,
      y: 0,
      zoom: 1,
    });
  });
});

describe("revealViewport (VID-22, VID-25)", () => {
  const v = { x: 40, y: 300, zoom: 0.8 };

  it("leaves the view alone when the card is in view", () => {
    // Card at x = 380: 344..600 on screen, inside an 800 px canvas.
    expect(revealViewport(v, { x: 380, y: 0 }, 800, 900)).toBeNull();
  });

  it("centers a card that the narrower canvas hides, at the same zoom", () => {
    // Card at x = 1140: 952..1208 on screen, past an 800 px canvas.
    const next = revealViewport(v, { x: 1140, y: 0 }, 800, 900);
    expect(next).toEqual({
      x: (800 - 256) / 2 - 1140 * 0.8,
      y: 300,
      zoom: 0.8,
    });
  });

  it("leaves alone a card at the edge of a fitted level, FIT_PAD from the side", () => {
    const fitted = { x: FIT_PAD, y: 300, zoom: 0.72 };
    expect(revealViewport(fitted, { x: 0, y: 0 }, 1104, 900)).toBeNull();
  });

  it("brings back a card hidden above or below the canvas", () => {
    const next = revealViewport(v, { x: 0, y: 1000 }, 1600, 900);
    expect(next).toEqual({ x: 40, y: (900 - 112) / 2 - 800, zoom: 0.8 });
  });
});

const eight = [Array.from({ length: 8 }, (_, i) => `n${i}`)];

/** Every card of `positions` inside the canvas, below the header, seen through `v`. */
function allInside(
  positions: ReturnType<typeof layoutRows>,
  v: { x: number; y: number; zoom: number },
  width: number,
  height: number,
) {
  return [...positions.values()].every(
    (p) =>
      p.x * v.zoom + v.x >= 0 &&
      (p.x + NODE_WIDTH) * v.zoom + v.x <= width &&
      p.y * v.zoom + v.y >= TOP_PAD - 1e-9 &&
      (p.y + 140) * v.zoom + v.y <= height,
  );
}

describe("chooseWrap (VID-03, VID-10, VID-23)", () => {
  const main = (k: number) => layoutRows(wrapRows(eight, k));

  it("wraps the 8-card main flow into rows of 5 and 3 at 1600x900, like the video's 5 cards", () => {
    expect(chooseWrap(8, main, 1600, 900)).toBe(5);
    expect(fitZoom(main(5), 1600, 900)).toBeGreaterThanOrEqual(MIN_START_ZOOM);
  });

  it("wraps into rows of 4 at 1366x768, above 0.8", () => {
    expect(chooseWrap(8, main, 1366, 768)).toBe(4);
    expect(fitZoom(main(4), 1366, 768)).toBeGreaterThan(MIN_START_ZOOM);
  });

  it("takes the largest zoom when no row length reaches 0.8: rows of 3 beside the panel at 1366x768", () => {
    // The canvas beside the panel is about 940 px wide.
    expect(chooseWrap(8, main, 940, 768)).toBe(3);
    const z = fitZoom(main(3), 940, 768);
    expect(z).toBeLessThan(MIN_START_ZOOM);
    expect(z).toBeGreaterThanOrEqual(LEGIBLE_ZOOM);
  });

  it("keeps a level that fits whole at a legible zoom: calcular_frete beside the panel", () => {
    const C = "fn:calcular_frete";
    const level = projectLevel(videoGraph, C);
    const lr = layoutLR(level.nodes, level.edges, C);
    const cols = (k: number) => wrapColumns(lr, k).positions;
    expect(chooseWrap(4, cols, 940, 768)).toBeNull();
    expect(chooseWrap(4, cols, 1100, 900)).toBeNull();
  });

  it("wraps the 8 steps inside processar_pedido into bands of 3 beside the panel", () => {
    const P = "fn:processar_pedido";
    const level = projectLevel(videoGraph, P);
    const lr = layoutLR(level.nodes, level.edges, P);
    const cols = (k: number) => wrapColumns(lr, k).positions;
    expect(chooseWrap(8, cols, 1100, 900)).toBe(3);
    expect(chooseWrap(8, cols, 940, 768)).toBe(3);
    expect(fitZoom(cols(3), 940, 768)).toBeGreaterThanOrEqual(MIN_START_ZOOM);
  });

  it("wraps a level too tall for a legible whole view into rows that fill the width at 0.8", () => {
    const long = (k: number) =>
      layoutRows(wrapRows([Array.from({ length: 60 }, (_, i) => `n${i}`)], k));
    const n = chooseWrap(60, long, 1400, 890);
    expect(n).toBe(4);
    expect(fitZoom(long(60), 1400, 890)).toBeLessThan(LEGIBLE_ZOOM);
    expect(fitZoom(long(n ?? 0), 1400, 890)).toBeLessThan(LEGIBLE_ZOOM);
    const v = levelViewport(long(4), 1400, 890, undefined, WRAP_PAD);
    expect(v.zoom).toBe(MIN_START_ZOOM);
  });

  it("measures a wrapped level with WRAP_PAD at the sides, room for the turning wires", () => {
    // Rows of 5 fit 1540 px at 0.81 with FIT_PAD but only 0.78 with WRAP_PAD.
    expect(fitZoom(main(5), 1540, 900)).toBeGreaterThanOrEqual(MIN_START_ZOOM);
    expect(fitZoom(main(5), 1540, 900, WRAP_PAD)).toBeLessThan(MIN_START_ZOOM);
    expect(chooseWrap(8, main, 1540, 900)).toBe(4);
  });

  it("fitViewport keeps a wrapped level WRAP_PAD from the sides", () => {
    const v = fitViewport(main(5), 1600, 900, undefined, WRAP_PAD);
    expect(v?.x).toBe(WRAP_PAD);
    expect(v?.zoom).toBeCloseTo((1600 - 2 * WRAP_PAD) / 1840);
  });

  it("returns null when nothing is legible, before the canvas has a size, or for one column", () => {
    expect(chooseWrap(8, main, 100, 100)).toBeNull();
    expect(chooseWrap(8, main, 0, 0)).toBeNull();
    expect(chooseWrap(1, main, 1600, 900)).toBeNull();
  });
});

describe("fitViewport (VID-03, VID-23, VID-25, VID-27)", () => {
  it("shows every card of the wrapped main flow, centered in the free area", () => {
    const pos = layoutRows(wrapRows(eight, 4));
    const v = fitViewport(pos, 1600, 900);
    expect(v).not.toBeNull();
    if (!v) return;
    expect(v.zoom).toBe(1);
    // 1460 wide, 540 tall (rows from -90 to 450).
    expect(v.x).toBe(FIT_PAD + (1600 - 2 * FIT_PAD - 1460) / 2);
    expect(v.y).toBe(TOP_PAD + (900 - TOP_PAD - FIT_PAD - 540) / 2 + 90);
    expect(allInside(pos, v, 1600, 900)).toBe(true);
  });

  it("shows all of calcular_frete beside the panel at 1366x768 and 1600x900", () => {
    const C = "fn:calcular_frete";
    const level = projectLevel(videoGraph, C);
    const pos = layoutLR(level.nodes, level.edges, C);
    for (const [w, h] of [
      [940, 768],
      [1100, 900],
    ] as const) {
      const v = fitViewport(pos, w, h);
      expect(v?.zoom).toBeGreaterThanOrEqual(LEGIBLE_ZOOM);
      expect(v && allInside(pos, v, w, h)).toBe(true);
    }
  });

  it("returns null when the whole level would be below the legible zoom", () => {
    expect(fitViewport(layoutRows(eight), 1600, 900)).toBeNull();
    expect(fitViewport(new Map(), 1600, 900)).toBeNull();
  });

  it("moves the focus card toward the middle as far as every card stays in view", () => {
    const pos = layoutRows([["a", "b"]]);
    const plain = fitViewport(pos, 1600, 900);
    const focused = fitViewport(pos, 1600, 900, pos.get("b"));
    // The center of b goes to the middle: 800 - (380 + 160) = 260.
    expect(focused?.x).toBe(260);
    expect(focused?.x).not.toBe(plain?.x);
    expect(focused && allInside(pos, focused, 1600, 900)).toBe(true);
  });

  it("stops at the edge: a focus card at the end of a full row keeps the row in view", () => {
    const pos = layoutRows(wrapRows(eight, 4));
    const v = fitViewport(pos, 1600, 900, pos.get("n3"));
    // n3 wants the level 600 px to the left, but its first card stops at FIT_PAD.
    expect(v?.x).toBe(FIT_PAD);
    expect(v && allInside(pos, v, 1600, 900)).toBe(true);
  });
});

describe("levelViewport (VID-03, VID-27)", () => {
  it("fits the whole level when it is legible", () => {
    const pos = layoutRows(wrapRows(eight, 4));
    expect(levelViewport(pos, 1600, 900)).toEqual(fitViewport(pos, 1600, 900));
  });

  it("falls back to startViewport for a level that is too big", () => {
    const pos = layoutRows(eight);
    expect(levelViewport(pos, 1600, 900)).toEqual(
      startViewport(pos, 1600, 900),
    );
  });

  it("centers the focus card at zoom 1 in the free area below Voltar when the level is too big", () => {
    const pos = layoutRows(eight);
    // The free area runs from TOP_PAD (140) to FIT_PAD (24) above the bottom.
    expect(levelViewport(pos, 1600, 900, { x: 760, y: 0 })).toEqual({
      x: (1600 - 320) / 2 - 760,
      y: 140 + (900 - 140 - 24 - 140) / 2,
      zoom: 1,
    });
  });
});
