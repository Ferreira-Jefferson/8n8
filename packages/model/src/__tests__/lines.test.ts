import { describe, expect, it } from "vitest";
import { sliceLines } from "../lines";

describe("sliceLines", () => {
  const source = "a = 1\nb = 2\nc = 3\nd = 4";

  it("treats the range as 1-based and inclusive", () => {
    expect(sliceLines(source, { start: 2, end: 3 })).toBe("b = 2\nc = 3");
  });

  it("keeps the original indentation", () => {
    const code = "def f():\n    if x:\n        return 1\n    return 2";
    expect(sliceLines(code, { start: 2, end: 3 })).toBe(
      "    if x:\n        return 1",
    );
  });

  it("returns a single line when start equals end", () => {
    expect(sliceLines(source, { start: 3, end: 3 })).toBe("c = 3");
  });

  it("returns the last line when the source has no trailing newline", () => {
    expect(sliceLines(source, { start: 4, end: 4 })).toBe("d = 4");
  });

  it("returns the right lines when the source uses \r\n", () => {
    const crlf = "a = 1\r\nb = 2\r\nc = 3";
    expect(sliceLines(crlf, { start: 2, end: 3 })).toBe("b = 2\nc = 3");
  });
});
