import { describe, expect, it } from "vitest";
import { backSides, pickSides, Side } from "../sides";

const at = (x: number, y: number) => ({ x, y });

describe("pickSides", () => {
  it("uses right and left for a target far to the right", () => {
    expect(pickSides(at(0, 0), at(500, 100))).toEqual([Side.Right, Side.Left]);
  });

  it("uses left and right for a target far to the left", () => {
    expect(pickSides(at(500, 0), at(0, 100))).toEqual([Side.Left, Side.Right]);
  });

  it("uses bottom and top for a target below", () => {
    expect(pickSides(at(0, 0), at(100, 400))).toEqual([Side.Bottom, Side.Top]);
  });

  it("uses top and bottom for a target above", () => {
    expect(pickSides(at(0, 400), at(100, 0))).toEqual([Side.Top, Side.Bottom]);
  });

  it("keeps right and left for a target at the same height", () => {
    expect(pickSides(at(0, 50), at(400, 50))).toEqual([Side.Right, Side.Left]);
  });

  it("changes from the sides to top and bottom when the gap gets taller than 1/1.4 of its width", () => {
    expect(pickSides(at(0, 0), at(450, 300))).toEqual([Side.Right, Side.Left]);
    expect(pickSides(at(0, 0), at(400, 300))).toEqual([Side.Bottom, Side.Top]);
  });
});

describe("backSides", () => {
  it("runs below both cards when they stand side by side", () => {
    expect(backSides(at(500, 0), at(0, 40))).toEqual([
      Side.Bottom,
      Side.Bottom,
    ]);
  });

  it("runs on the left of both cards when they stand one above the other", () => {
    expect(backSides(at(0, 400), at(0, 0))).toEqual([Side.Left, Side.Left]);
  });
});
