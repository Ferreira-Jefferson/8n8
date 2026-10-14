import { describe, expect, it } from "vitest";
// vitest.config.ts includes styles.css, so `?raw` gives its text.
import css from "../styles.css?raw";

/** The declarations of the rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  if (css === "") throw new Error("styles.css came back empty");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
  if (!m?.[1]) throw new Error(`no rule ${selector}`);
  return m[1];
}

describe("styles: editor (VID-08)", () => {
  it("fits the panel and the button row in the window height", () => {
    const r = rule(".editor");
    expect(r).toContain("--editor-top: min(170px, 19vh);");
    expect(r).toContain("height: calc(100vh - var(--editor-top));");
    expect(r).toContain("box-sizing: border-box;");
    expect(r).toContain("flex-direction: column;");
    const panel = rule(".editor-panel");
    expect(panel).toContain("height: 620px;");
    expect(panel).toContain("flex: 0 1 auto;");
    expect(panel).toContain("min-height: 0;");
  });

  it("scrolls long code lines instead of wrapping them", () => {
    const r = rule(".editor textarea");
    expect(r).toContain("white-space: pre;");
    expect(r).toContain("overflow: auto;");
  });
});

describe("styles: panel code (VID-29)", () => {
  it("scales the mono size to the panel and scrolls long lines inside the block", () => {
    const r = rule(".detail-panel .code-view");
    expect(r).toContain("font-size: clamp(16px, 1.23vw, 26px);");
    expect(r).toContain("overflow-x: auto;");
    expect(r).toContain("scrollbar-width: thin;");
  });

  it("never lets the panel squeeze the block, which would hide lines", () => {
    expect(rule(".detail-panel .code-view")).toContain("flex-shrink: 0;");
  });

  it("glows at an edge while code is hidden past it", () => {
    const r = rule(".detail-panel .code-view");
    expect(r.match(/no-repeat local/g)).toHaveLength(2);
    expect(r.match(/no-repeat scroll/g)).toHaveLength(2);
  });
});

describe("styles: panel beside the level (VID-23, VID-25)", () => {
  it("scales the video's 1060 px panel down to 400..520 px, so the canvas keeps the level legible", () => {
    expect(rule(".map.with-panel")).toContain(
      "grid-template-columns: 1fr clamp(400px, 31vw, 520px);",
    );
  });

  it("gives the panel eyebrows a smaller size that wraps cleanly", () => {
    const r = rule(".detail-panel .eyebrow");
    expect(r).toContain("font-size: 14px;");
    expect(r).toContain("line-height: 1.5;");
  });
});

describe("styles: breadcrumb (VID-19)", () => {
  it("stays on one line", () => {
    const r = rule(".breadcrumb");
    expect(r).toContain("display: flex;");
    expect(r).toContain("white-space: nowrap;");
    expect(r).toContain("overflow: hidden;");
  });

  it("cuts the middle items with … first and keeps the last one whole", () => {
    const item = rule(".breadcrumb button");
    expect(item).toContain("text-overflow: ellipsis;");
    expect(item).toContain("min-width: 4ch;");
    expect(
      rule(".breadcrumb button:not(:first-child):not(:last-child)"),
    ).toContain("flex-shrink: 1000;");
    expect(rule(".breadcrumb button:last-child")).toContain("flex-shrink: 0;");
    expect(rule(".breadcrumb span")).toContain("flex-shrink: 0;");
  });
});

describe("styles: branch labels (VID-21)", () => {
  it("are 22 px eyebrow labels, uppercase and tracked, on one line", () => {
    const r = rule(".branch-label");
    expect(r).toContain("font-size: 22px;");
    expect(r).toContain("letter-spacing: 0.18em;");
    expect(r).toContain("text-transform: uppercase;");
    expect(r).toContain("white-space: nowrap;");
    expect(r).toContain("color: var(--accent);");
    expect(rule('.branch-label[data-branch-label="sim"]')).toContain(
      "color: var(--main);",
    );
  });
});
