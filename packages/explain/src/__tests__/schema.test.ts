import { describe, expect, it } from "vitest";
import { type Draft, type DraftSuggestion, parseExplanation } from "../schema";

const suggestion = (
  line: number,
  command = `cmd ${line}`,
): DraftSuggestion => ({
  command,
  reason: "motivo",
  line,
  severity: "media",
});

const explanation = (suggestions: DraftSuggestion[]): Draft => ({
  summary: "Calcula o frete.",
  inputs: ["peso"],
  outputs: ["valor"],
  suggestions,
});

describe("parseExplanation (CORE-16, CORE-22)", () => {
  it("reads plain JSON and fenced ```json JSON the same way", () => {
    const value = explanation([suggestion(2)]);
    const raw = JSON.stringify(value);
    expect(parseExplanation(raw, 4)).toEqual(value);
    expect(parseExplanation(`\`\`\`json\n${raw}\n\`\`\``, 4)).toEqual(value);
  });

  it("throws when the text is not JSON", () => {
    expect(() => parseExplanation("não é JSON", 4)).toThrow();
  });

  it("throws when the JSON does not match the schema", () => {
    const { summary: _, ...noSummary } = explanation([]);
    expect(() => parseExplanation(JSON.stringify(noSummary), 4)).toThrow();
    const badSeverity = explanation([
      { ...suggestion(1), severity: "critica" as never },
    ]);
    expect(() => parseExplanation(JSON.stringify(badSeverity), 4)).toThrow();
    const fractionalLine = explanation([suggestion(1.5)]);
    expect(() => parseExplanation(JSON.stringify(fractionalLine), 4)).toThrow();
  });

  it("drops suggestions whose line is outside 1..lineCount (CORE-22)", () => {
    const raw = JSON.stringify(
      explanation([suggestion(0), suggestion(1), suggestion(4), suggestion(5)]),
    );
    expect(parseExplanation(raw, 4).suggestions.map((s) => s.line)).toEqual([
      1, 4,
    ]);
  });

  it("keeps the first 5 valid suggestions in order", () => {
    const seven = [1, 2, 3, 4, 1, 2, 3].map((line, i) =>
      suggestion(line, `cmd ${i}`),
    );
    const result = parseExplanation(JSON.stringify(explanation(seven)), 4);
    expect(result.suggestions).toEqual(seven.slice(0, 5));
  });

  it("returns inputs as plain strings, without claim ids (FID-01)", () => {
    const raw = JSON.stringify({ ...explanation([]), inputs: ["peso"] });
    expect(parseExplanation(raw, 4).inputs).toEqual(["peso"]);
  });

  it("accepts zero suggestions", () => {
    const value = explanation([]);
    expect(parseExplanation(JSON.stringify(value), 4)).toEqual(value);
  });
});
