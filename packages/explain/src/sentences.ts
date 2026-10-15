import type { ClaimId } from "@8n8/model";
import type { Draft } from "./schema";

export interface DraftClaim {
  id: ClaimId;
  text: string;
  kind: "sentence" | "input" | "output" | "suggestion";
}

/** Cuts after `.`, `!` or `?` followed by whitespace, outside backticks; trims and drops empty parts (C1). */
export function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inCode = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    current += ch;
    if (ch === "`") inCode = !inCode;
    else if (!inCode && /[.!?]/.test(ch) && /\s/.test(text[i + 1] ?? "")) {
      parts.push(current);
      current = "";
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

/** Positional ids in draft order: s1.. sentences, i1.. inputs, o1.. outputs, g1.. suggestions (C1). */
export function toClaims(draft: Draft): DraftClaim[] {
  const claims = (
    prefix: string,
    kind: DraftClaim["kind"],
    texts: string[],
  ): DraftClaim[] =>
    texts.map((text, i) => ({ id: `${prefix}${i + 1}`, text, kind }));
  return [
    ...claims("s", "sentence", splitSentences(draft.summary)),
    ...claims("i", "input", draft.inputs),
    ...claims("o", "output", draft.outputs),
    ...claims(
      "g",
      "suggestion",
      draft.suggestions.map((s) => `${s.command} ${s.reason}`),
    ),
  ];
}
