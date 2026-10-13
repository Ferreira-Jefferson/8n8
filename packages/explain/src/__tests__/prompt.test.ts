import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../prompt";

const ptsRules = readFileSync(
  new URL(
    "../../../../docs/portugues-tecnico-simplificado.md",
    import.meta.url,
  ),
  "utf8",
);

describe("buildSystemPrompt (CORE-16, CORE-18)", () => {
  it("embeds the PTS rules unchanged", () => {
    expect(buildSystemPrompt(ptsRules).text).toContain(ptsRules);
  });

  it("asks for JSON with summary, inputs, outputs and 0 to 5 suggestions with line and severity", () => {
    const { text } = buildSystemPrompt(ptsRules);
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
    const { text, version } = buildSystemPrompt(ptsRules);
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    expect(version).toBe(
      createHash("sha256").update(text).digest("hex").slice(0, 12),
    );
  });

  it("gives the same version for the same rules and a new one for other rules", () => {
    expect(buildSystemPrompt("regra A").version).toBe(
      buildSystemPrompt("regra A").version,
    );
    expect(buildSystemPrompt("regra A").version).not.toBe(
      buildSystemPrompt("regra B").version,
    );
  });

  it("asks for backticked identifiers and forbids absent numbers and units (FID-02, FID-03, FID-04)", () => {
    const { text } = buildSystemPrompt(ptsRules);
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
    expect(buildSystemPrompt("regra A").version).not.toBe(featureOneVersion);
  });
});
