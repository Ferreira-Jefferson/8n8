import { createHash } from "node:crypto";
import { type ClaimId, DEFAULT_LOCALE, type Locale } from "@8n8/model";
import { z } from "zod";
import { type Problem, UNITS, UNITS_EN } from "./checks";
import type { PromptLanguage } from "./language";
import { wordsOf } from "./messages";
import { absent, listOf } from "./schema";
import type { DraftClaim } from "./sentences";

/** Bump when the review rules change without a text change (FID-07, C4). */
const REVIEW_RULES_VERSION = "1";

const reviewerPt = (
  lang: PromptLanguage,
) => `Você revisa uma explicação de código ${lang.label}, item por item.
Você recebe o código de um nó com as linhas numeradas de 1 a n, os nomes dos nós vizinhos e uma lista de itens, cada um com um ID.
Julgue cada item só pelo código. Um item é suportado quando o código mostra o que ele afirma.
Uma sugestão é suportada quando o problema descrito no motivo está visível no código.
Para cada item, dê um veredicto e as linhas de evidência: os números das linhas do código que mostram o que o item afirma.
Responda só com JSON válido, sem texto fora do JSON e sem cercas de código.
O JSON tem o campo "verdicts": uma lista com um objeto por item, com "id" (o ID do item), "supported" (true ou false), "evidence" (lista de números de linha, de 1 a n) e "problem" (o motivo, quando "supported" é false).
Exemplo:
{"verdicts":[{"id":"s1","supported":true,"evidence":[2,3]},{"id":"s2","supported":false,"evidence":[],"problem":"O código não mostra esse valor."}]}`;

const reviewerEn = (
  lang: PromptLanguage,
) => `You review an explanation of ${lang.label} code, item by item.
You receive the code of a node with lines numbered from 1 to n, the names of the neighbour nodes and a list of items, each with an ID.
Judge each item only by the code. An item is supported when the code shows what it states.
A suggestion is supported when the problem described in the reason is visible in the code.
For each item, give a verdict and the evidence lines: the numbers of the code lines that show what the item states.
Answer with valid JSON only, with no text outside the JSON and no code fences.
The JSON has the field "verdicts": a list with one object per item, with "id" (the ID of the item), "supported" (true or false), "evidence" (list of line numbers, from 1 to n) and "problem" (the reason, when "supported" is false).
Example:
{"verdicts":[{"id":"s1","supported":true,"evidence":[2,3]},{"id":"s2","supported":false,"evidence":[],"problem":"The code does not show this value."}]}`;

const reviewer = (lang: PromptLanguage, locale: Locale) =>
  locale === "en" ? reviewerEn(lang) : reviewerPt(lang);

/** Reviewer system prompt; version = sha256(prompt + redraft template + JSON(UNITS) + rules version)[:12] (C3, C5). */
export function buildReviewerPrompt(
  lang: PromptLanguage,
  locale: Locale = DEFAULT_LOCALE,
): {
  text: string;
  version: string;
} {
  const text = reviewer(lang, locale);
  const words = wordsOf(locale);
  const version = createHash("sha256")
    .update(
      [
        text,
        words.redraftHeader,
        words.redraftFooter,
        JSON.stringify(locale === "en" ? [...UNITS, ...UNITS_EN] : UNITS),
        REVIEW_RULES_VERSION,
      ].join("\n"),
    )
    .digest("hex")
    .slice(0, 12);
  return { text, version };
}

/** The user turn that asks for a new draft without the listed claims (FID-08). */
export function redraftMessage(
  problems: Problem[],
  locale: Locale = DEFAULT_LOCALE,
): string {
  const words = wordsOf(locale);
  return [
    words.redraftHeader,
    ...problems.map((p) => `- ${p.id} «${p.text}»: ${p.problem}`),
    words.redraftFooter,
  ].join("\n");
}

/** Only the numbered code, the neighbour names and the claims as `- <id>: <text>` (FID-06). */
export function reviewerMessage(
  code: string,
  neighbours: string[],
  claims: DraftClaim[],
  locale: Locale = DEFAULT_LOCALE,
): string {
  const words = wordsOf(locale);
  const numbered = code
    .split("\n")
    .map((line, i) => `${i + 1} | ${line}`)
    .join("\n");
  return [
    words.code,
    numbered,
    `${words.neighbours}: ${neighbours.join(", ") || words.none}`,
    words.items,
    ...claims.map((c) => `- ${c.id}: ${c.text}`),
  ].join("\n");
}

const verdictsSchema = z.object({
  // A verdict with a null id or supported judges nothing: its item reads "not judged".
  verdicts: listOf(
    z.object({
      id: z.string(),
      supported: z.boolean(),
      // Plain integers; the range is checked per claim in applyVerdicts (L-005).
      evidence: listOf(z.number().int()),
      // Null is "no problem".
      problem: absent(z.string()),
    }),
    ["id", "supported"],
  ),
});

export type Verdict = z.infer<typeof verdictsSchema>["verdicts"][number];

/** Strips fences, parses and validates the reviewer answer; throws on invalid JSON or schema (C3). */
export function parseVerdicts(raw: string): Verdict[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return verdictsSchema.parse(JSON.parse(cleaned)).verdicts;
}

export interface ReviewedClaim extends DraftClaim {
  /** Evidence lines relative to the node, sorted and unique. */
  lines: number[];
}

/** A claim is kept only with a supported verdict and evidence inside 1..lineCount (FID-07). */
export function applyVerdicts(
  claims: DraftClaim[],
  verdicts: Verdict[],
  lineCount: number,
  locale: Locale = DEFAULT_LOCALE,
): { kept: ReviewedClaim[]; problems: Problem[] } {
  const words = wordsOf(locale);
  const kept: ReviewedClaim[] = [];
  const problems: Problem[] = [];
  const byId = new Map<ClaimId, Verdict>();
  for (const v of verdicts) if (!byId.has(v.id)) byId.set(v.id, v);
  for (const claim of claims) {
    const v = byId.get(claim.id);
    const reject = (problem: string) =>
      problems.push({ id: claim.id, text: claim.text, problem });
    if (!v) reject(words.notJudged);
    else if (!v.supported) reject(v.problem || words.notShown);
    else if (v.evidence.length === 0) reject(words.noEvidence);
    else if (v.evidence.some((n) => n < 1 || n > lineCount)) {
      reject(words.evidenceOutside);
    } else {
      const lines = [...new Set(v.evidence)].sort((a, b) => a - b);
      kept.push({ ...claim, lines });
    }
  }
  return { kept, problems };
}
