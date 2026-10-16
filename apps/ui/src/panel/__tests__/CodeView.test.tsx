import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CodeView } from "../CodeView";

afterEach(cleanup);

const code = [
  "    if peso > 30:",
  "        return base + taxa * 2",
  "    else:",
].join("\n");

function lines(container: HTMLElement) {
  return [...container.querySelectorAll("[data-line]")].map((el) => ({
    no: el.querySelector(".line-no")?.textContent,
    text: el.querySelector("code")?.textContent,
    current: el.getAttribute("aria-current"),
  }));
}

describe("CodeView", () => {
  it("numbers the lines from range.start with exact text and indentation (CORE-14)", () => {
    const { container } = render(<CodeView code={code} start={12} />);
    expect(lines(container).map(({ no, text }) => ({ no, text }))).toEqual([
      { no: "12", text: "    if peso > 30:" },
      { no: "13", text: "        return base + taxa * 2" },
      { no: "14", text: "    else:" },
    ]);
  });

  it("colors Python and TypeScript by file extension without changing the text", () => {
    const py = render(<CodeView code={code} start={12} file="a/preco.py" />);
    expect(py.container.querySelector(".hljs-keyword")?.textContent).toBe("if");
    expect(lines(py.container).map((l) => l.text)).toEqual(code.split("\n"));
    cleanup();
    const ts = render(
      <CodeView code="const x: number = 1;" start={1} file="a.ts" />,
    );
    expect(ts.container.querySelector(".hljs-keyword")?.textContent).toBe(
      "const",
    );
    expect(ts.container.querySelector(".hljs-number")?.textContent).toBe("1");
  });

  it("keeps a multiline string colored on every line", () => {
    const doc = ['x = """um', 'dois"""'].join("\n");
    const { container } = render(<CodeView code={doc} start={1} file="a.py" />);
    const rows = [...container.querySelectorAll("[data-line]")];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.querySelector(".hljs-string")).not.toBeNull();
    }
  });

  it("shows plain text when the extension is unknown", () => {
    const { container } = render(
      <CodeView code="if x" start={1} file="a.zzz" />,
    );
    expect(container.querySelector(".hljs-keyword")).toBeNull();
    expect(lines(container)[0]?.text).toBe("if x");
  });

  it("marks only the highlighted line (CORE-24)", () => {
    const { container } = render(
      <CodeView code={code} start={12} highlightedLines={new Set([13])} />,
    );
    expect(lines(container).map((l) => l.current)).toEqual([
      null,
      "true",
      null,
    ]);
  });

  it("marks no line without highlightedLines", () => {
    const { container } = render(<CodeView code={code} start={12} />);
    expect(container.querySelectorAll("[aria-current]")).toHaveLength(0);
  });

  it("marks exactly every line in highlightedLines (FID-13)", () => {
    const { container } = render(
      <CodeView
        code={["a", "b", "c", "d", "e", "f", "g", "h"].join("\n")}
        start={4}
        highlightedLines={new Set([5, 6, 7])}
      />,
    );
    const marked = [...container.querySelectorAll("[aria-current]")].map(
      (el) => [el.getAttribute("data-line"), el.getAttribute("aria-current")],
    );
    expect(marked).toEqual([
      ["5", "true"],
      ["6", "true"],
      ["7", "true"],
    ]);
    expect(container.querySelectorAll(".code-line.current")).toHaveLength(3);
  });
});
