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
      <CodeView code={code} start={12} highlightedLine={13} />,
    );
    expect(lines(container).map((l) => l.current)).toEqual([
      null,
      "true",
      null,
    ]);
  });

  it("marks no line without highlightedLine", () => {
    const { container } = render(<CodeView code={code} start={12} />);
    expect(container.querySelectorAll("[aria-current]")).toHaveLength(0);
  });
});
