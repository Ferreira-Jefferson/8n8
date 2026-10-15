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

const suggestionSchema = z.object({
  command: z.string(),
  reason: z.string(),
  // SPEC_DEVIATION: design.md says `line: int ≥ 1`; here only `int`.
  // Reason: T29/CORE-22 require line 0 to be dropped, not to reject the whole answer.
  line: z.number().int(),
  severity: z.enum(["alta", "media", "baixa"]),
});

const summarySchema = z.object({
  summary: z.string(),
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
});

const suggestionsSchema = z.object({
  suggestions: z.array(suggestionSchema),
  docstring: z.object({ reflects: z.boolean(), reason: z.string() }).optional(),
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
