import { describe, expect, it } from "vitest";
import { layoutRows } from "../layout";
import { MIN_START_ZOOM, SIDE_PAD, startViewport, TOP_PAD } from "../viewport";

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
