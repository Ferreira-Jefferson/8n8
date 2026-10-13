import { describe, expect, it } from "vitest";
import { formatLines } from "../format-lines";

describe("formatLines (FID-12)", () => {
  it.each([
    [[5], "L5"],
    [[5, 6, 7], "L5–7"],
    [[5, 6, 7, 9], "L5–7, L9"],
    [[9, 5], "L5, L9"],
    [[6, 8], "L6, L8"],
  ])("formats %j as %s", (lines, expected) => {
    expect(formatLines(lines)).toBe(expected);
  });
});
