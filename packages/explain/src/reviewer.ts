import { createHash } from "node:crypto";
import type { ClaimId } from "@code2n8n/model";
import { z } from "zod";
import { type Problem, UNITS } from "./checks";
import type { PromptLanguage } from "./language";
import type { DraftClaim } from "./sentences";

/** Bump when the review rules change without a text change (FID-07, C4). */
const REVIEW_RULES_VERSION = "1";

const reviewer = (
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

const REDRAFT_HEADER = "Problemas encontrados:";
const REDRAFT_FOOTER = "Reescreva o JSON inteiro sem essas afirmações.";

/** Reviewer system prompt; version = sha256(prompt + redraft template + JSON(UNITS) + rules version)[:12] (C3, C5). */
export function buildReviewerPrompt(lang: PromptLanguage): {
  text: string;
  version: string;
} {
  const text = reviewer(lang);
  const version = createHash("sha256")
    .update(
      [
        text,
        REDRAFT_HEADER,
        REDRAFT_FOOTER,
        JSON.stringify(UNITS),
        REVIEW_RULES_VERSION,
      ].join("\n"),
    )
    .digest("hex")
    .slice(0, 12);
  return { text, version };
}

/** The user turn that asks for a new draft without the listed claims (FID-08). */
export function redraftMessage(problems: Problem[]): string {
  return [
    REDRAFT_HEADER,
    ...problems.map((p) => `- ${p.id} «${p.text}»: ${p.problem}`),
    REDRAFT_FOOTER,
  ].join("\n");
}

/** Only the numbered code, the neighbour names and the claims as `- <id>: <text>` (FID-06). */
export function reviewerMessage(
  code: string,
  neighbours: string[],
  claims: DraftClaim[],
): string {
  const numbered = code
    .split("\n")
    .map((line, i) => `${i + 1} | ${line}`)
    .join("\n");
  return [
    "Código:",
    numbered,
    `Vizinhos: ${neighbours.join(", ") || "nenhum"}`,
    "Itens:",
    ...claims.map((c) => `- ${c.id}: ${c.text}`),
  ].join("\n");
}

const verdictsSchema = z.object({
  verdicts: z.array(
    z.object({
      id: z.string(),
      supported: z.boolean(),
      // Plain integers; the range is checked per claim in applyVerdicts (L-005).
      evidence: z.array(z.number().int()),
      problem: z.string().optional(),
    }),
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
): { kept: ReviewedClaim[]; problems: Problem[] } {
  const kept: ReviewedClaim[] = [];
  const problems: Problem[] = [];
  const byId = new Map<ClaimId, Verdict>();
  for (const v of verdicts) if (!byId.has(v.id)) byId.set(v.id, v);
  for (const claim of claims) {
    const v = byId.get(claim.id);
    const reject = (problem: string) =>
      problems.push({ id: claim.id, text: claim.text, problem });
    if (!v) reject("o revisor não julgou este item");
    else if (!v.supported) reject(v.problem || "o código não mostra isso");
    else if (v.evidence.length === 0) reject("sem linha de evidência");
    else if (v.evidence.some((n) => n < 1 || n > lineCount)) {
      reject("linha de evidência fora do nó");
    } else {
      const lines = [...new Set(v.evidence)].sort((a, b) => a - b);
      kept.push({ ...claim, lines });
    }
  }
  return { kept, problems };
}
