import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildStepPrompt, buildSystemPrompt } from "../prompt";
import { PY } from "./py";

const ptsRules = readFileSync(
  new URL(
    "../../../../docs/portugues-tecnico-simplificado.md",
    import.meta.url,
  ),
  "utf8",
);

describe("buildSystemPrompt (CORE-16, CORE-18)", () => {
  it("embeds the PTS rules unchanged", () => {
    expect(buildSystemPrompt(ptsRules, PY).text).toContain(ptsRules);
  });

  it("asks for JSON with summary, inputs, outputs and 0 to 5 suggestions with line and severity", () => {
    const { text } = buildSystemPrompt(ptsRules, PY);
    expect(text).toContain("JSON");
    for (const field of [
      '"summary"',
      '"inputs"',
      '"outputs"',
      '"suggestions"',
      '"line"',
      '"severity"',
    ]) {
      expect(text).toContain(field);
    }
    expect(text).toContain("de 0 a 5 sugestões");
  });

  it("versions the text with the first 12 hex chars of its sha256", () => {
    const { text, version } = buildSystemPrompt(ptsRules, PY);
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    expect(version).toBe(
      createHash("sha256").update(text).digest("hex").slice(0, 12),
    );
  });

  it("gives the same version for the same rules and a new one for other rules", () => {
    expect(buildSystemPrompt("regra A", PY).version).toBe(
      buildSystemPrompt("regra A", PY).version,
    );
    expect(buildSystemPrompt("regra A", PY).version).not.toBe(
      buildSystemPrompt("regra B", PY).version,
    );
  });

  it("asks for backticked identifiers and forbids absent numbers and units (FID-02, FID-03, FID-04)", () => {
    const { text } = buildSystemPrompt(ptsRules, PY);
    expect(text).toContain(
      "Cite entre crases cada identificador do código (variável, parâmetro, função, classe ou módulo), como `peso` ou `requests.get`.",
    );
    expect(text).toContain(
      "Não escreva número nem unidade (como kg, %, R$ ou segundos) que não aparece no código.",
    );
  });

  it("gives a new version once the text gains the new rules", () => {
    // Version of the feature-01 prompt text for the same rules "regra A".
    const featureOneVersion = "05b31dfd312b";
    expect(buildSystemPrompt("regra A", PY).version).not.toBe(
      featureOneVersion,
    );
  });
});

describe("buildStepPrompt (VID-28)", () => {
  it("explains a step inside a function in one or two sentences", () => {
    const { text } = buildStepPrompt(ptsRules, PY);
    expect(text).toContain("passo de dentro de uma função");
    expect(text).toContain(
      '"summary": resumo do que o passo faz, em uma ou duas frases.',
    );
    expect(text).not.toContain("uma a três frases");
  });

  it("keeps the backtick and number rules and the PTS rules", () => {
    const { text } = buildStepPrompt(ptsRules, PY);
    expect(text).toContain(
      "Cite entre crases cada identificador do código (variável, parâmetro, função, classe ou módulo), como `peso` ou `requests.get`.",
    );
    expect(text).toContain(
      "Não escreva número nem unidade (como kg, %, R$ ou segundos) que não aparece no código.",
    );
    expect(text).toContain(ptsRules);
  });

  it("versions the text with 12 hex chars, apart from the full prompt", () => {
    const { text, version } = buildStepPrompt(ptsRules, PY);
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    expect(version).toBe(
      createHash("sha256").update(text).digest("hex").slice(0, 12),
    );
    expect(version).not.toBe(buildSystemPrompt(ptsRules, PY).version);
    expect(buildStepPrompt("regra A", PY).version).not.toBe(
      buildStepPrompt("regra B", PY).version,
    );
  });
});

describe("docstring omitted from the code", () => {
  it("tells the model the docstring is omitted and asks for the optional docstring field", () => {
    for (const { text } of [
      buildSystemPrompt("regra A", PY),
      buildStepPrompt("regra A", PY),
    ]) {
      expect(text).toContain("sem a docstring");
      expect(text).toContain('"reflects"');
      expect(text).toContain('"Docstring"');
    }
  });
});
