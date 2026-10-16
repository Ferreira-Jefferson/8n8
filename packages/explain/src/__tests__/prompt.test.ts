import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildStepSummaryPrompt,
  buildSuggestionsPrompt,
  buildSummaryPrompt,
} from "../prompt";
import { PY } from "./py";

const ptsRules = readFileSync(
  new URL(
    "../../../../docs/writing-rules/portugues-tecnico-simplificado.md",
    import.meta.url,
  ),
  "utf8",
);

const ALL = [
  ["summary", buildSummaryPrompt],
  ["step summary", buildStepSummaryPrompt],
  ["suggestions", buildSuggestionsPrompt],
] as const;

describe.each(ALL)("%s prompt (CORE-16, CORE-18)", (_, build) => {
  it("embeds the PTS rules unchanged", () => {
    expect(build(ptsRules, PY).text).toContain(ptsRules);
  });

  it("versions the text with the first 12 hex chars of its sha256", () => {
    const { text, version } = build(ptsRules, PY);
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    expect(version).toBe(
      createHash("sha256").update(text).digest("hex").slice(0, 12),
    );
  });

  it("gives the same version for the same rules and a new one for other rules", () => {
    expect(build("regra A", PY).version).toBe(build("regra A", PY).version);
    expect(build("regra A", PY).version).not.toBe(build("regra B", PY).version);
  });

  it("asks for backticked identifiers, forbids absent numbers and units, and says the docstring is omitted (FID-02, FID-03, FID-04)", () => {
    const { text } = build(ptsRules, PY);
    expect(text).toContain(
      "Cite entre crases cada identificador do código (variável, parâmetro, função, classe ou módulo), como `peso` ou `requests.get`.",
    );
    expect(text).toContain(
      "Não escreva número nem unidade (como kg, %, R$ ou segundos) que não aparece no código.",
    );
    expect(text).toContain("sem a docstring");
    expect(text).toContain("JSON");
  });
});

describe("the three prompts are different texts", () => {
  it("has a version of its own per prompt", () => {
    const versions = ALL.map(([, build]) => build(ptsRules, PY).version);
    expect(new Set(versions).size).toBe(3);
  });
});

describe("summary prompts ask only for the summary (CFG-03)", () => {
  it.each([buildSummaryPrompt, buildStepSummaryPrompt])(
    "asks for summary, inputs and outputs, and never for suggestions or the docstring verdict",
    (build) => {
      const { text } = build(ptsRules, PY);
      for (const field of ['"summary"', '"inputs"', '"outputs"']) {
        expect(text).toContain(field);
      }
      for (const field of ['"suggestions"', '"docstring"', '"reflects"']) {
        expect(text).not.toContain(field);
      }
    },
  );

  it("asks for one to three sentences for a node and one or two for a step (VID-28)", () => {
    expect(buildSummaryPrompt(ptsRules, PY).text).toContain(
      '"summary": resumo do que o nó faz, em uma a três frases.',
    );
    const step = buildStepSummaryPrompt(ptsRules, PY).text;
    expect(step).toContain("passo de dentro de uma função");
    expect(step).toContain(
      '"summary": resumo do que o passo faz, em uma ou duas frases.',
    );
    expect(step).not.toContain("uma a três frases");
  });
});

describe("suggestions prompt asks only for suggestions (CFG-03)", () => {
  it("asks for 0 to 5 suggestions with line and severity, and the optional docstring verdict", () => {
    const { text } = buildSuggestionsPrompt(ptsRules, PY);
    for (const field of [
      '"suggestions"',
      '"command"',
      '"reason"',
      '"line"',
      '"severity"',
      '"docstring"',
      '"reflects"',
      '"Docstring"',
    ]) {
      expect(text).toContain(field);
    }
    expect(text).toContain("de 0 a 5 sugestões");
  });

  it("never asks for the summary, the inputs or the outputs", () => {
    const { text } = buildSuggestionsPrompt(ptsRules, PY);
    for (const field of ['"summary"', '"inputs"', '"outputs"']) {
      expect(text).not.toContain(field);
    }
  });
});
