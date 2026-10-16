import type { Severity } from "@8n8/model";
import { z } from "zod";

const MAX_SUGGESTIONS = 5;

/** A suggestion as the LLM writes it: no id, no evidence lines. */
export interface DraftSuggestion {
  command: string;
  reason: string;
  line: number;
  severity: Severity;
}

/** The raw LLM answer: plain strings, no claim ids (FID-01). */
export interface Draft {
  summary: string;
  inputs: string[];
  outputs: string[];
  suggestions: DraftSuggestion[];
  /** Present only when the request had a docstring: does it match the code? */
  docstring?: { reflects: boolean; reason: string };
}

// A model writes null for "nothing here": it never reaches the reader as an error or as the word null.

/** A list left as null is empty; an item that is null, or has null in one of `required`, is dropped. */
export function listOf<T extends z.ZodType>(item: T, required: string[] = []) {
  return z.preprocess(
    (value) =>
      Array.isArray(value)
        ? value.filter(
            (entry) =>
              entry !== null &&
              !required.some(
                (key) => (entry as Record<string, unknown>)[key] === null,
              ),
          )
        : value === null
          ? []
          : value,
    z.array(item),
  );
}

/** A field left as null counts as absent. */
export function absent<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (value === null ? undefined : value),
    schema.optional(),
  );
}

/** The words a model may write for a severity, in either language, by their plain form. */
const SEVERITY_ALIASES: Record<string, string> = {
  alto: "alta",
  high: "alta",
  medio: "media",
  medium: "media",
  baixo: "baixa",
  low: "baixa",
};

const suggestionSchema = z.object({
  command: z.string(),
  reason: z.string(),
  // SPEC_DEVIATION: design.md says `line: int ≥ 1`; here only `int`.
  // Reason: T29/CORE-22 require line 0 to be dropped, not to reject the whole answer.
  line: z.number().int(),
  // The contract is Portuguese; a model that writes the English word, or an accent, still means the same level.
  severity: z.preprocess(
    (value) =>
      typeof value === "string"
        ? (SEVERITY_ALIASES[
            value.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
          ] ?? value)
        : value,
    z.enum(["alta", "media", "baixa"]),
  ),
});

const summarySchema = z.object({
  // No summary: the review finds no sentence and answers unfaithful.
  summary: z.preprocess((value) => (value === null ? "" : value), z.string()),
  inputs: listOf(z.string()),
  outputs: listOf(z.string()),
});

const suggestionsSchema = z.object({
  // A suggestion with a null field is incomplete: it is dropped, like one with line 0.
  suggestions: listOf(suggestionSchema, [
    "command",
    "reason",
    "line",
    "severity",
  ]),
  // A docstring verdict with a null field says nothing: it counts as absent.
  docstring: absent(
    z.preprocess(
      (value) =>
        value !== null &&
        typeof value === "object" &&
        Object.values(value).includes(null)
          ? undefined
          : value,
      z.object({ reflects: z.boolean(), reason: z.string() }).optional(),
    ),
  ),
});

/** Strips the code fences some models add and parses the JSON. */
function jsonOf(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

/** The summary part as a Draft with no suggestions; other fields of the answer are ignored (CFG-03). */
export function parseSummary(raw: string): Draft {
  const { summary, inputs, outputs } = summarySchema.parse(jsonOf(raw));
  return { summary, inputs, outputs, suggestions: [] };
}

/** The suggestions part as a Draft with an empty summary; keeps the first 5 suggestions with line in 1..lineCount (CORE-22, CFG-03). */
export function parseSuggestions(raw: string, lineCount: number): Draft {
  const { suggestions, docstring } = suggestionsSchema.parse(jsonOf(raw));
  return {
    summary: "",
    inputs: [],
    outputs: [],
    ...(docstring ? { docstring } : {}),
    suggestions: suggestions
      .filter((s) => s.line >= 1 && s.line <= lineCount)
      .slice(0, MAX_SUGGESTIONS),
  };
}
