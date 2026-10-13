import type { Severity } from "@code2n8n/model";
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
}

const explanationSchema = z.object({
  summary: z.string(),
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
  suggestions: z.array(
    z.object({
      command: z.string(),
      reason: z.string(),
      // SPEC_DEVIATION: design.md says `line: int ≥ 1`; here only `int`.
      // Reason: T29/CORE-22 require line 0 to be dropped, not to reject the whole answer.
      line: z.number().int(),
      severity: z.enum(["alta", "media", "baixa"]),
    }),
  ),
});

/** Strips fences, parses and validates the LLM answer; keeps the first 5 suggestions with line in 1..lineCount (CORE-22). */
export function parseExplanation(raw: string, lineCount: number): Draft {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const parsed = explanationSchema.parse(JSON.parse(cleaned));
  return {
    ...parsed,
    suggestions: parsed.suggestions
      .filter((s) => s.line >= 1 && s.line <= lineCount)
      .slice(0, MAX_SUGGESTIONS),
  };
}
