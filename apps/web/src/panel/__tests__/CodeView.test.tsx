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
