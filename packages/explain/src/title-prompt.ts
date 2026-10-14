import { createHash } from "node:crypto";
import { TITLE_MAX_WORDS, type TitleItem } from "@code2n8n/model";
import { z } from "zod";
import { KIND_LABEL } from "./explain";
import type { PromptLanguage } from "./language";

const role = (
  lang: PromptLanguage,
) => `Você escreve títulos de nós de um fluxo de código ${lang.label}.
Você recebe uma lista de nós. Cada nó tem um ID (n1, n2...), o tipo, o nome, os nomes dos nós que ele chama, os nomes dos nós que o chamam e o código do nó com as linhas numeradas de 1 a n.
O código chega sem a docstring. O título vem só do código.
Escreva um título por nó.
O título diz a ação do nó com verbo no infinitivo, como "Calcular frete" ou "Buscar UF pelo CEP".
O título tem no máximo ${TITLE_MAX_WORDS} palavras e não termina com ponto final.
Não escreva número nem unidade (como kg, %, R$ ou segundos) que não aparece no código do nó.`;

const FORMAT = `Responda só com JSON válido, sem texto fora do JSON e sem cercas de código.
O JSON tem o campo "titles": uma lista com um objeto por nó, com "id" (o ID do nó) e "title" (o título).
Exemplo:
{"titles":[{"id":"n1","title":"Calcular frete"}]}`;

/** Title prompt with role, JSON format and PTS rules; version = first 12 hex of sha256(text) (VID-14). */
export function buildTitlePrompt(
  ptsRules: string,
  lang: PromptLanguage,
): {
  text: string;
  version: string;
} {
  const text = `${role(lang)}\n\n${FORMAT}\n\nEscreva os títulos com as regras abaixo.\n\n${ptsRules}`;
  const version = createHash("sha256").update(text).digest("hex").slice(0, 12);
  return { text, version };
}

const numbered = (code: string) =>
  code
    .split("\n")
    .map((line, i) => `${i + 1} | ${line}`)
    .join("\n");

/** One block per item, in order, with positional ids n1..nk (VID-14). */
export function titleMessage(items: TitleItem[]): string {
  const list = (names: string[]) => names.join(", ") || "nenhum";
  return items
    .map((item, i) =>
      [
        `[n${i + 1}] Tipo: ${KIND_LABEL[item.kind]} | Nome: ${item.name}`,
        `Chama: ${list(item.calls)}`,
        `Chamado por: ${list(item.calledBy)}`,
        "Código:",
        numbered(item.code),
      ].join("\n"),
    )
    .join("\n\n");
}

const titlesSchema = z.object({
  titles: z.array(z.object({ id: z.string(), title: z.string() })),
});

/** Strips fences, parses and validates; trims each title and drops empty ones; throws on invalid JSON or schema. */
export function parseTitles(raw: string): { id: string; title: string }[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return titlesSchema
    .parse(JSON.parse(cleaned))
    .titles.map((t) => ({ id: t.id, title: t.title.trim() }))
    .filter((t) => t.title !== "");
}
