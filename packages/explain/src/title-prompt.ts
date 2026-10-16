import { createHash } from "node:crypto";
import {
  DEFAULT_LOCALE,
  type Locale,
  TITLE_MAX_WORDS,
  type TitleItem,
} from "@8n8/model";
import { z } from "zod";
import type { PromptLanguage } from "./language";
import { wordsOf } from "./messages";
import { listOf } from "./schema";

const rolePt = (
  lang: PromptLanguage,
) => `Você escreve títulos de nós de um fluxo de código ${lang.label}.
Você recebe uma lista de nós. Cada nó tem um ID (n1, n2...), o tipo, o nome, os nomes dos nós que ele chama, os nomes dos nós que o chamam e o código do nó com as linhas numeradas de 1 a n.
O código chega sem a docstring. O título vem só do código.
Escreva um título por nó.
O título diz a ação do nó com verbo no infinitivo, como "Calcular frete" ou "Buscar UF pelo CEP".
O título tem no máximo ${TITLE_MAX_WORDS} palavras e não termina com ponto final.
Não escreva número nem unidade (como kg, %, R$ ou segundos) que não aparece no código do nó.`;

const roleEn = (
  lang: PromptLanguage,
) => `You write titles of nodes of a ${lang.label} code flow.
You receive a list of nodes. Each node has an ID (n1, n2...), the type, the name, the names of the nodes it calls, the names of the nodes that call it and the code of the node with lines numbered from 1 to n.
The code arrives without the docstring. The title comes only from the code.
Write one title per node.
The title says the action of the node with a verb in the base form, like "Calculate shipping" or "Look up state by ZIP code".
The title has at most ${TITLE_MAX_WORDS} words and does not end with a period. A title may omit articles.
Do not write a number or a unit (like kg, %, $ or seconds) that does not appear in the code of the node.`;

const FORMAT_EN = `Answer with valid JSON only, with no text outside the JSON and no code fences.
The JSON has the field "titles": a list with one object per node, with "id" (the ID of the node) and "title" (the title).
Example:
{"titles":[{"id":"n1","title":"Calculate shipping"}]}`;

const FORMAT_PT = `Responda só com JSON válido, sem texto fora do JSON e sem cercas de código.
O JSON tem o campo "titles": uma lista com um objeto por nó, com "id" (o ID do nó) e "title" (o título).
Exemplo:
{"titles":[{"id":"n1","title":"Calcular frete"}]}`;

const role = (lang: PromptLanguage, locale: Locale) =>
  locale === "en" ? roleEn(lang) : rolePt(lang);

/** Title prompt with role, JSON format and PTS rules; version = first 12 hex of sha256(text) (VID-14). */
export function buildTitlePrompt(
  rules: string,
  lang: PromptLanguage,
  locale: Locale = DEFAULT_LOCALE,
): {
  text: string;
  version: string;
} {
  const format = locale === "en" ? FORMAT_EN : FORMAT_PT;
  const intro =
    locale === "en"
      ? "Write the titles with the rules below."
      : "Escreva os títulos com as regras abaixo.";
  const text = `${role(lang, locale)}\n\n${format}\n\n${intro}\n\n${rules}`;
  const version = createHash("sha256").update(text).digest("hex").slice(0, 12);
  return { text, version };
}

const numbered = (code: string) =>
  code
    .split("\n")
    .map((line, i) => `${i + 1} | ${line}`)
    .join("\n");

/** One block per item, in order, with positional ids n1..nk (VID-14). */
export function titleMessage(
  items: TitleItem[],
  locale: Locale = DEFAULT_LOCALE,
): string {
  const words = wordsOf(locale);
  const list = (names: string[]) => names.join(", ") || words.none;
  return items
    .map((item, i) =>
      [
        `[n${i + 1}] ${words.type}: ${words.kinds[item.kind]} | ${words.name}: ${item.name}`,
        `${words.calls}: ${list(item.calls)}`,
        `${words.calledBy}: ${list(item.calledBy)}`,
        words.code,
        numbered(item.code),
      ].join("\n"),
    )
    .join("\n\n");
}

const titlesSchema = z.object({
  // A null title, or one with a null field, is dropped like an empty one.
  titles: listOf(z.object({ id: z.string(), title: z.string() }), [
    "id",
    "title",
  ]),
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
