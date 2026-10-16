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

describe("styles: card tag", () => {
  /** The declarations of the rule whose selector list contains `selector`. */
  function ruleWith(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = css.match(new RegExp(`${escaped}[^{]*\\{([^}]*)\\}`));
    if (!m?.[1]) throw new Error(`no rule with ${selector}`);
    return m[1];
  }

  it("paints the structure (folders, files and loose code) in the main green", () => {
    for (const tag of ["PASTA", "ARQUIVO", "CÓDIGO SOLTO"]) {
      expect(ruleWith(`.node[data-tag="${tag}"] .tag`)).toContain(
        "color: var(--main);",
      );
    }
  });

  it("paints the code that runs in the bright second colour", () => {
    for (const tag of ["FUNÇÃO", "SE", "LAÇO", "BLOCO", "CÓDIGO", "RETORNO"]) {
      expect(ruleWith(`.node[data-tag="${tag}"] .tag`)).toContain(
        "color: var(--second);",
      );
    }
  });

  it("paints what leaves the code, the external bridges, in copper", () => {
    for (const tag of ["HTTP", "BANCO", "DISCO", "E-MAIL", "EXTERNO"]) {
      expect(ruleWith(`.node[data-tag="${tag}"] .tag`)).toContain(
        "color: var(--warm);",
      );
    }
  });

  it("has no GATILHO tag rule", () => {
    expect(css).not.toContain('data-tag="GATILHO"');
  });

  it("keeps the default grey for a tag no rule names", () => {
    expect(rule(".node .tag")).toContain("color: var(--accent);");
  });
});

describe("styles: dependency wires", () => {
  it("draws calls with dashes that shorten and move, and gives inheritance and imports their own still patterns", () => {
    expect(rule(".edge-calls .wire")).toContain(
      "stroke-dasharray: 29 8 18 8 10 8 3 8;",
    );
    expect(rule(".edge-calls .wire")).toContain("animation: wire-march");
    expect(css).toMatch(
      /\.edge-imports \.wire \{[^}]*stroke-dasharray: 19 8 3 8;/,
    );
    expect(css).toMatch(
      /\.edge-extends \.wire \{[^}]*stroke-dasharray: 19 8 3 8 3 8;/,
    );
  });

  it("paints a wire gray inside a file and green across files", () => {
    expect(rule(".reach-inside .wire")).toContain("stroke: var(--dim);");
    expect(rule(".reach-across .wire")).toContain("stroke: var(--main);");
  });

  it("makes the end of a dependency wire a hollow ring and the start a dot", () => {
    expect(rule(".react-flow__handle.port.port-dep.port-in")).toContain(
      "background: var(--ground);",
    );
    expect(rule(".react-flow__handle.port.port-dep.port-inside")).toContain(
      "background: var(--dim);",
    );
  });
});

describe("styles: panel code (VID-29)", () => {
  it("sets a dense mono size and wraps long lines, so the code shows in full", () => {
    const r = rule(".detail-panel .code-view");
    expect(r).toContain("font-size: 14px;");
    expect(r).toContain("white-space: pre-wrap;");
    expect(r).not.toContain("overflow-x");
  });

  it("never lets the panel squeeze the block, which would hide lines", () => {
    expect(rule(".detail-panel .code-view")).toContain("flex-shrink: 0;");
  });
});

describe("styles: panel beside the level (VID-23, VID-25)", () => {
  it("scales the video's 1060 px panel down to 400..520 px, so the canvas keeps the level legible", () => {
    expect(rule(".map.with-panel")).toContain(
      "grid-template-columns: 1fr auto clamp(400px, 31vw, 520px);",
    );
  });

  it("shows a drag cursor on the bar that resizes the panel", () => {
    const r = rule(".panel-resizer");
    expect(r).toContain("cursor: col-resize;");
    expect(r).toContain("touch-action: none;");
  });

  it("gives the panel eyebrows a smaller size that wraps cleanly", () => {
    const r = rule(".detail-panel .eyebrow");
    expect(r).toContain("font-size: 11px;");
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
    expect(rule('.branch-label[data-branch-label="true"]')).toContain(
      "color: var(--main);",
    );
  });
});

describe("styles: history button", () => {
  const right = (selector: string) =>
    Number(rule(selector).match(/right: (\d+)px;/)?.[1]);

  it("sits at the far right, with Novo código just left of it and the breadcrumb clear of both", () => {
    expect(right(".history-btn")).toBe(24);
    expect(rule(".history-btn")).toContain("top: 29px;");
    expect(right(".map-area > .new-code")).toBeGreaterThan(
      right(".history-btn"),
    );
    expect(right(".breadcrumb")).toBeGreaterThan(
      right(".map-area > .new-code"),
    );
  });
});

describe("styles: brand rules", () => {
  it("paints an error in Cobre, the color of attention", () => {
    expect(rule('[role="alert"]')).toContain("color: var(--warm);");
  });

  it("keeps the on-demand button on a loaded weight of Space Grotesk (400, 500, 700)", () => {
    expect(rule(".detail-panel .ask")).toContain("font: 700 18px");
  });
});

describe("styles: settings dialog actions", () => {
  it("gives Salvar and Fechar the same size: padding, border, font and width", () => {
    const both = rule(".dialog-actions .btn,\n.dialog-actions .btn-ghost");
    expect(both).toContain("min-width: 140px;");
    expect(both).toContain("padding: 12px 24px;");
    expect(both).toContain("border: 2px solid var(--panel-border);");
    expect(both).toContain("font: 700 22px var(--font-sans);");
  });
});
