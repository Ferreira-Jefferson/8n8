import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { UNITS } from "../checks";
import {
  applyTitleVerdicts,
  buildTitleReviewerPrompt,
  TITLE_RULES_VERSION,
  type TitleBlock,
  titleLayerOne,
  titleReviewerMessage,
} from "../title-reviewer";
import { PY } from "./py";

const CODE = [
  "def calcular_frete(peso):",
  "    if peso > 30:",
  "        return 50",
].join("\n");
const ctx = { code: CODE, neighbours: ["buscar_tabela"] };

describe("buildTitleReviewerPrompt (VID-16)", () => {
  it("starts with the exact role line the fake LLM recognizes", () => {
    expect(buildTitleReviewerPrompt(PY).text.split("\n")[0]).toBe(
      "Você revisa títulos de nós de um fluxo de código Python.",
    );
  });

  it("asks for the verdicts contract", () => {
    const { text } = buildTitleReviewerPrompt(PY);
    for (const field of ['"verdicts"', '"supported"', '"evidence"']) {
      expect(text).toContain(field);
    }
  });

  it("versions text + units + rules version, so a new text gives a new version", () => {
    const { text, version } = buildTitleReviewerPrompt(PY);
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    expect(version).toBe(
      createHash("sha256")
        .update([text, JSON.stringify(UNITS), TITLE_RULES_VERSION].join("\n"))
        .digest("hex")
        .slice(0, 12),
    );
    expect(version).not.toBe(
      createHash("sha256")
        .update(
          [`${text} `, JSON.stringify(UNITS), TITLE_RULES_VERSION].join("\n"),
        )
        .digest("hex")
        .slice(0, 12),
    );
  });
});

describe("titleLayerOne (VID-14, VID-16)", () => {
  it("passes a title of exactly 6 words and drops one of 7", () => {
    expect(titleLayerOne("Calcular o frete pelo peso informado", ctx)).toBe(
      null,
    );
    expect(
      titleLayerOne("Calcular o frete pelo peso informado agora", ctx),
    ).toMatch(/palavras/);
  });

  it("drops a unit that is not in the code", () => {
    expect(titleLayerOne("Peso acima de 30 kg?", ctx)).toMatch(/kg/);
  });

  it("drops a number that is not in the code", () => {
    expect(titleLayerOne("Peso acima de 40?", ctx)).toMatch(/40/);
    expect(titleLayerOne("Peso acima de 30?", ctx)).toBe(null);
  });

  it("drops an invented backticked identifier and keeps a neighbour name", () => {
    expect(titleLayerOne("Somar `taxa_extra`", ctx)).toMatch(/taxa_extra/);
    expect(titleLayerOne("Chamar `buscar_tabela`", ctx)).toBe(null);
  });
});

const block = (overrides: Partial<TitleBlock>): TitleBlock => ({
  id: "n1",
  title: "Calcular frete",
  code: CODE,
  neighbours: [],
  ...overrides,
});

describe("titleReviewerMessage (VID-16)", () => {
  it("writes one Nó block per title with its own numbered code, neighbours and title line", () => {
    const message = titleReviewerMessage([
      block({ id: "n1", title: "Calcular frete", neighbours: ["main"] }),
      block({ id: "n3", title: "Retornar 50", code: "return 50" }),
    ]);
    expect(message).toBe(
      [
        "Nó n1:",
        "Código:",
        "1 | def calcular_frete(peso):",
        "2 |     if peso > 30:",
        "3 |         return 50",
        "Vizinhos: main",
        "- n1: Calcular frete",
        "",
        "Nó n3:",
        "Código:",
        "1 | return 50",
        "Vizinhos: nenhum",
        "- n3: Retornar 50",
      ].join("\n"),
    );
  });
});

describe("applyTitleVerdicts (VID-16)", () => {
  const blocks = [
    block({ id: "n1" }),
    block({ id: "n2", title: "Peso acima de 30?" }),
    block({ id: "n3", title: "Retornar 50", code: "return 50" }),
    block({ id: "n4", title: "Somar peso" }),
    block({ id: "n5", title: "Ler peso" }),
  ];

  it("keeps only supported titles with evidence inside their own node", () => {
    const kept = applyTitleVerdicts(blocks, [
      { id: "n1", supported: true, evidence: [3, 1, 1] },
      { id: "n2", supported: false, evidence: [2], problem: "não" },
      // n3 has one line: line 2 is outside the node.
      { id: "n3", supported: true, evidence: [2] },
      { id: "n4", supported: true, evidence: [] },
      // n5 has no verdict.
    ]);
    expect(kept).toEqual([{ id: "n1", text: "Calcular frete", lines: [1, 3] }]);
  });
});
