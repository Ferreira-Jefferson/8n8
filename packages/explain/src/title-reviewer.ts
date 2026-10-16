import { createHash } from "node:crypto";
import { DEFAULT_LOCALE, type Locale, TITLE_MAX_WORDS } from "@8n8/model";
import {
  type CheckContext,
  checkIdentifiers,
  checkNumbers,
  checkUnits,
  UNITS,
  UNITS_EN,
} from "./checks";
import type { PromptLanguage } from "./language";
import { wordsOf } from "./messages";
import { applyVerdicts, type Verdict } from "./reviewer";

/** Bump when the title review rules change without a text change (VID-16). */
export const TITLE_RULES_VERSION = "1";

const reviewerPt = (
  lang: PromptLanguage,
) => `Você revisa títulos de nós de um fluxo de código ${lang.label}.
Você recebe um bloco por nó, com o código do nó com as linhas numeradas de 1 a n, os nomes dos nós vizinhos e o título do nó com o ID do nó.
Julgue cada título só pelo código do próprio nó. Um título é suportado quando o código do nó mostra o que o título afirma.
Para cada título, dê um veredicto e as linhas de evidência: os números das linhas do código do nó que mostram o que o título afirma.
Responda só com JSON válido, sem texto fora do JSON e sem cercas de código.
O JSON tem o campo "verdicts": uma lista com um objeto por título, com "id" (o ID do nó), "supported" (true ou false), "evidence" (lista de números de linha, de 1 a n) e "problem" (o motivo, quando "supported" é false).
Exemplo:
{"verdicts":[{"id":"n1","supported":true,"evidence":[1,2]},{"id":"n2","supported":false,"evidence":[],"problem":"O código não mostra essa ação."}]}`;

const reviewerEn = (
  lang: PromptLanguage,
) => `You review titles of nodes of a ${lang.label} code flow.
You receive one block per node, with the code of the node with lines numbered from 1 to n, the names of the neighbour nodes and the title of the node with the ID of the node.
Judge each title only by the code of its own node. A title is supported when the code of the node shows what the title states.
For each title, give a verdict and the evidence lines: the numbers of the lines of the node code that show what the title states.
Answer with valid JSON only, with no text outside the JSON and no code fences.
The JSON has the field "verdicts": a list with one object per title, with "id" (the ID of the node), "supported" (true or false), "evidence" (list of line numbers, from 1 to n) and "problem" (the reason, when "supported" is false).
Example:
{"verdicts":[{"id":"n1","supported":true,"evidence":[1,2]},{"id":"n2","supported":false,"evidence":[],"problem":"The code does not show this action."}]}`;

const reviewer = (lang: PromptLanguage, locale: Locale) =>
  locale === "en" ? reviewerEn(lang) : reviewerPt(lang);

/** Title reviewer system prompt; version = sha256(text + JSON(UNITS) + rules version)[:12] (VID-16). */
export function buildTitleReviewerPrompt(
  lang: PromptLanguage,
  locale: Locale = DEFAULT_LOCALE,
): {
  text: string;
  version: string;
} {
  const text = reviewer(lang, locale);
  const version = createHash("sha256")
    .update(
      [
        text,
        JSON.stringify(locale === "en" ? [...UNITS, ...UNITS_EN] : UNITS),
        TITLE_RULES_VERSION,
      ].join("\n"),
    )
    .digest("hex")
    .slice(0, 12);
  return { text, version };
}

/** A title that passed layer one, with the normalized code and neighbours of its node. */
export interface TitleBlock {
  /** Positional id n1..nk of the title request. */
  id: string;
  title: string;
  code: string;
  neighbours: string[];
}

/** One `Nó nX:` block per title: numbered node code, neighbours and `- nX: <title>` (VID-16). */
export function titleReviewerMessage(
  blocks: TitleBlock[],
  locale: Locale = DEFAULT_LOCALE,
): string {
  const words = wordsOf(locale);
  return blocks
    .map((b) =>
      [
        `${words.node} ${b.id}:`,
        words.code,
        b.code
          .split("\n")
          .map((line, i) => `${i + 1} | ${line}`)
          .join("\n"),
        `${words.neighbours}: ${b.neighbours.join(", ") || words.none}`,
        `- ${b.id}: ${b.title}`,
      ].join("\n"),
    )
    .join("\n\n");
}

/** Layer one for a title: at most TITLE_MAX_WORDS words, then numbers, units and identifiers against its own node (VID-14, VID-16). */
export function titleLayerOne(title: string, ctx: CheckContext): string | null {
  const words = title.split(/\s+/).filter((w) => w !== "").length;
  if (words > TITLE_MAX_WORDS) {
    return wordsOf(ctx.locale ?? DEFAULT_LOCALE).titleTooLong(
      words,
      TITLE_MAX_WORDS,
    );
  }
  return (
    checkNumbers(title, ctx) ??
    checkUnits(title, ctx) ??
    checkIdentifiers(title, ctx)
  );
}

/** Keeps a title only with a supported verdict and evidence inside its own node; lines relative, sorted, unique (VID-16). */
export function applyTitleVerdicts(
  blocks: TitleBlock[],
  verdicts: Verdict[],
  locale: Locale = DEFAULT_LOCALE,
): { id: string; text: string; lines: number[] }[] {
  return blocks.flatMap((b) =>
    applyVerdicts(
      [{ id: b.id, text: b.title, kind: "sentence" }],
      verdicts,
      b.code.split("\n").length,
      locale,
    ).kept.map(({ id, text, lines }) => ({ id, text, lines })),
  );
}
