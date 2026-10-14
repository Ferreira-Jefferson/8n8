import { createHash } from "node:crypto";
import { TITLE_MAX_WORDS } from "@code2n8n/model";
import {
  type CheckContext,
  checkIdentifiers,
  checkNumbers,
  checkUnits,
  UNITS,
} from "./checks";
import type { PromptLanguage } from "./language";
import { applyVerdicts, type Verdict } from "./reviewer";

/** Bump when the title review rules change without a text change (VID-16). */
export const TITLE_RULES_VERSION = "1";

const reviewer = (
  lang: PromptLanguage,
) => `Você revisa títulos de nós de um fluxo de código ${lang.label}.
Você recebe um bloco por nó, com o código do nó com as linhas numeradas de 1 a n, os nomes dos nós vizinhos e o título do nó com o ID do nó.
Julgue cada título só pelo código do próprio nó. Um título é suportado quando o código do nó mostra o que o título afirma.
Para cada título, dê um veredicto e as linhas de evidência: os números das linhas do código do nó que mostram o que o título afirma.
Responda só com JSON válido, sem texto fora do JSON e sem cercas de código.
O JSON tem o campo "verdicts": uma lista com um objeto por título, com "id" (o ID do nó), "supported" (true ou false), "evidence" (lista de números de linha, de 1 a n) e "problem" (o motivo, quando "supported" é false).
Exemplo:
{"verdicts":[{"id":"n1","supported":true,"evidence":[1,2]},{"id":"n2","supported":false,"evidence":[],"problem":"O código não mostra essa ação."}]}`;

/** Title reviewer system prompt; version = sha256(text + JSON(UNITS) + rules version)[:12] (VID-16). */
export function buildTitleReviewerPrompt(lang: PromptLanguage): {
  text: string;
  version: string;
} {
  const text = reviewer(lang);
  const version = createHash("sha256")
    .update([text, JSON.stringify(UNITS), TITLE_RULES_VERSION].join("\n"))
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
export function titleReviewerMessage(blocks: TitleBlock[]): string {
  return blocks
    .map((b) =>
      [
        `Nó ${b.id}:`,
        "Código:",
        b.code
          .split("\n")
          .map((line, i) => `${i + 1} | ${line}`)
          .join("\n"),
        `Vizinhos: ${b.neighbours.join(", ") || "nenhum"}`,
        `- ${b.id}: ${b.title}`,
      ].join("\n"),
    )
    .join("\n\n");
}

/** Layer one for a title: at most TITLE_MAX_WORDS words, then numbers, units and identifiers against its own node (VID-14, VID-16). */
export function titleLayerOne(title: string, ctx: CheckContext): string | null {
  const words = title.split(/\s+/).filter((w) => w !== "").length;
  if (words > TITLE_MAX_WORDS) {
    return `o título tem ${words} palavras, mais de ${TITLE_MAX_WORDS}`;
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
): { id: string; text: string; lines: number[] }[] {
  return blocks.flatMap((b) =>
    applyVerdicts(
      [{ id: b.id, text: b.title, kind: "sentence" }],
      verdicts,
      b.code.split("\n").length,
    ).kept.map(({ id, text, lines }) => ({ id, text, lines })),
  );
}
