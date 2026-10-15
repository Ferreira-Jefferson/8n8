import { describe, expect, it } from "vitest";
import {
  type DraftSuggestion,
  parseSuggestions,
  parseSummary,
} from "../schema";

const suggestion = (
  line: number,
  command = `cmd ${line}`,
): DraftSuggestion => ({
  command,
  reason: "motivo",
  line,
  severity: "media",
});

const summary = {
  summary: "Calcula o frete.",
  inputs: ["peso"],
  outputs: ["valor"],
};

const NO_SUMMARY = { summary: "", inputs: [], outputs: [] };

describe("parseSummary (CORE-16, CFG-03)", () => {
  it("reads plain JSON and fenced ```json JSON the same way, with no suggestions", () => {
    const raw = JSON.stringify(summary);
    const draft = { ...summary, suggestions: [] };
    expect(parseSummary(raw)).toEqual(draft);
    expect(parseSummary(`\`\`\`json\n${raw}\n\`\`\``)).toEqual(draft);
  });

  it("ignores suggestions and a docstring verdict in the answer", () => {
    const raw = JSON.stringify({
      ...summary,
      suggestions: [suggestion(1)],
      docstring: { reflects: false, reason: "x" },
    });
    expect(parseSummary(raw)).toEqual({ ...summary, suggestions: [] });
  });

  it("throws when the text is not JSON or the summary fields are missing", () => {
    expect(() => parseSummary("não é JSON")).toThrow();
    const { summary: _, ...noSummary } = summary;
    expect(() => parseSummary(JSON.stringify(noSummary))).toThrow();
    expect(() =>
      parseSummary(JSON.stringify({ ...summary, inputs: "peso" })),
    ).toThrow();
  });

  it("returns inputs as plain strings, without claim ids (FID-01)", () => {
    expect(parseSummary(JSON.stringify(summary)).inputs).toEqual(["peso"]);
  });
});

describe("parseSuggestions (CORE-22, CFG-03)", () => {
  const raw = (suggestions: DraftSuggestion[], extra = {}) =>
    JSON.stringify({ suggestions, ...extra });

  it("reads plain and fenced JSON, with an empty summary", () => {
    const value = { ...NO_SUMMARY, suggestions: [suggestion(2)] };
    expect(parseSuggestions(raw([suggestion(2)]), 4)).toEqual(value);
    expect(
      parseSuggestions(`\`\`\`json\n${raw([suggestion(2)])}\n\`\`\``, 4),
    ).toEqual(value);
  });

  it("ignores a summary in the answer", () => {
    expect(parseSuggestions(raw([], summary), 4)).toEqual({
      ...NO_SUMMARY,
      suggestions: [],
    });
  });

  it("throws when the text is not JSON or does not match the schema", () => {
    expect(() => parseSuggestions("não é JSON", 4)).toThrow();
    expect(() => parseSuggestions(JSON.stringify(summary), 4)).toThrow();
    expect(() =>
      parseSuggestions(
        raw([{ ...suggestion(1), severity: "critica" as never }]),
        4,
      ),
    ).toThrow();
    expect(() => parseSuggestions(raw([suggestion(1.5)]), 4)).toThrow();
  });

  it("drops suggestions whose line is outside 1..lineCount (CORE-22)", () => {
    const parsed = parseSuggestions(
      raw([suggestion(0), suggestion(1), suggestion(4), suggestion(5)]),
      4,
    );
    expect(parsed.suggestions.map((s) => s.line)).toEqual([1, 4]);
  });

  it("keeps the first 5 valid suggestions in order", () => {
    const seven = [1, 2, 3, 4, 1, 2, 3].map((line, i) =>
      suggestion(line, `cmd ${i}`),
    );
    expect(parseSuggestions(raw(seven), 4).suggestions).toEqual(
      seven.slice(0, 5),
    );
  });

  it("accepts zero suggestions", () => {
    expect(parseSuggestions(raw([]), 4).suggestions).toEqual([]);
  });

  it("keeps the optional docstring verdict and rejects a malformed one", () => {
    const docstring = { reflects: false, reason: "Cita `peso`." };
    expect(parseSuggestions(raw([], { docstring }), 4).docstring).toEqual(
      docstring,
    );
    expect(parseSuggestions(raw([]), 4)).not.toHaveProperty("docstring");
    expect(() =>
      parseSuggestions(raw([], { docstring: { reflects: "sim" } }), 4),
    ).toThrow();
  });
});
