/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Vitest does not process CSS, so `?raw` comes back empty: read the file.
// Vitest runs from apps/web.
const css = readFileSync("src/styles.css", "utf8");

/** The declarations of the rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
  if (!m?.[1]) throw new Error(`no rule ${selector}`);
  return m[1];
}

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
