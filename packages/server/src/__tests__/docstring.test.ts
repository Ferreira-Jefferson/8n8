import { describe, expect, it } from "vitest";
import { maskDocstring } from "../docstring";

const src = [
  "x = 1",
  "def f():",
  '    """Faz algo.',
  "",
  '    Mais."""',
  "    return 1",
  "y = 2",
];

describe("maskDocstring", () => {
  it("keeps the code as is when there is no docstring", () => {
    const out = maskDocstring({ start: 2, end: 6 }, undefined, src);
    expect(out).toEqual({ code: src.slice(1, 6).join("\n") });
    expect("docstring" in out).toBe(false);
  });

  it("blanks the docstring lines and keeps the line count", () => {
    const out = maskDocstring({ start: 2, end: 6 }, { start: 3, end: 5 }, src);
    expect(out.code).toBe(
      ["def f():", "# docstring omitida", "", "", "    return 1"].join("\n"),
    );
    expect(out.docstring).toEqual({
      text: ['    """Faz algo.', "", '    Mais."""'].join("\n"),
      line: 2,
    });
  });

  it("handles a one-line docstring at the start of the range", () => {
    const out = maskDocstring({ start: 1, end: 3 }, { start: 1, end: 1 }, [
      '"""Mod."""',
      "a = 1",
      "b = 2",
    ]);
    expect(out.code).toBe("# docstring omitida\na = 1\nb = 2");
    expect(out.docstring).toEqual({ text: '"""Mod."""', line: 1 });
  });
});
