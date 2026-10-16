import { createHash } from "node:crypto";
import {
  CHAT_MAX_CHARS,
  type ChatContext,
  DEFAULT_LOCALE,
  type Locale,
} from "@8n8/model";
import type { PromptLanguage } from "./language";
import { wordsOf } from "./messages";

/** The words of the chat prompts, in one language of the system. */
interface ChatTexts {
  role: (lang: PromptLanguage, max: number) => string;
  format: string;
  structureRole: (lang: PromptLanguage) => string;
  structureFormat: string;
  rulesIntro: string;
  parent: string;
}

const PT: ChatTexts = {
  role: (lang, max) =>
    `Você conversa com quem revisa código ${lang.label}, sobre um nó do fluxo de um programa e sobre o pai dele.
Você recebe o nó, o pai inteiro, os nomes dos nós que o nó chama e dos nós que o chamam, e o código com as linhas numeradas.
Responda só sobre esse código. Se a pergunta for sobre outra coisa, diga em uma frase que você só fala deste nó e do pai dele.
A resposta tem no máximo ${max} caracteres. Vá direto ao ponto: sem introdução e sem repetir a pergunta.
Para apontar uma linha, escreva \`L12\` (a letra L e o número da linha do código numerado). Cite só linhas que existem.
Explique só o que o código mostra. Não invente comportamento. Se o código não mostra a resposta, diga isso.`,
  format: `Responda só com JSON válido, sem texto fora do JSON e sem cercas de código.
O JSON tem estes campos:
- "reply": a resposta, em texto simples.
- "suggestion": null. Só quando a resposta propõe uma melhoria concreta para o código, escreva um objeto com "command" (a ação, no imperativo), "reason" (o motivo), "line" (a linha do código numerado) e "severity" ("alta", "media" ou "baixa").
Exemplo:
{"reply":"A chamada pode travar. Defina um timeout (L18).","suggestion":{"command":"Defina um timeout na chamada HTTP.","reason":"Sem timeout a chamada pode travar.","line":18,"severity":"media"}}`,
  structureRole: (lang) =>
    `Você transforma uma resposta de conversa em uma sugestão de melhoria para código ${lang.label}.
Você recebe o nó, o pai inteiro, o código com as linhas numeradas e o texto da resposta.
Se o texto propõe uma melhoria concreta para o código, escreva a sugestão. Se não propõe, escreva null.
Use só o que o texto e o código mostram. Não invente comportamento.`,
  structureFormat: `Responda só com JSON válido, sem texto fora do JSON e sem cercas de código.
O JSON tem um campo "suggestion": null, ou um objeto com "command" (a ação, no imperativo), "reason" (o motivo), "line" (a linha do código numerado) e "severity" ("alta", "media" ou "baixa").
Exemplo:
{"suggestion":{"command":"Valide se peso é positivo.","reason":"Peso negativo gera frete negativo.","line":8,"severity":"media"}}`,
  rulesIntro: "Escreva os textos do JSON com as regras abaixo.",
  parent: "Pai (inteiro)",
};

const EN: ChatTexts = {
  role: (lang, max) =>
    `You talk with someone who reviews ${lang.label} code, about one node of the flow of a program and about its parent.
You receive the node, the whole parent, the names of the nodes the node calls and of the nodes that call it, and the code with numbered lines.
Answer only about this code. If the question is about something else, say in one sentence that you only talk about this node and its parent.
The answer has at most ${max} characters. Go straight to the point: no introduction and no repeating the question.
To point at a line, write \`L12\` (the letter L and the number of the line in the numbered code). Cite only lines that exist.
Explain only what the code shows. Do not invent behavior. If the code does not show the answer, say so.`,
  format: `Answer with valid JSON only, with no text outside the JSON and no code fences.
The JSON has these fields:
- "reply": the answer, in plain text.
- "suggestion": null. Only when the answer proposes a concrete improvement for the code, write an object with "command" (the action, in the imperative), "reason" (the reason), "line" (the line of the numbered code) and "severity" (write exactly one of "alta" for high, "media" for medium or "baixa" for low).
Example:
{"reply":"The call can hang. Set a timeout (L18).","suggestion":{"command":"Set a timeout on the HTTP call.","reason":"Without a timeout the call can hang.","line":18,"severity":"media"}}`,
  structureRole: (lang) =>
    `You turn an answer of a conversation into an improvement suggestion for ${lang.label} code.
You receive the node, the whole parent, the code with numbered lines and the text of the answer.
If the text proposes a concrete improvement for the code, write the suggestion. If it does not, write null.
Use only what the text and the code show. Do not invent behavior.`,
  structureFormat: `Answer with valid JSON only, with no text outside the JSON and no code fences.
The JSON has one field "suggestion": null, or an object with "command" (the action, in the imperative), "reason" (the reason), "line" (the line of the numbered code) and "severity" (write exactly one of "alta" for high, "media" for medium or "baixa" for low).
Example:
{"suggestion":{"command":"Validate that weight is positive.","reason":"A negative weight gives a negative shipping.","line":8,"severity":"media"}}`,
  rulesIntro: "Write the texts of the JSON with the rules below.",
  parent: "Parent (whole)",
};

const TEXTS: Record<Locale, ChatTexts> = { "pt-BR": PT, en: EN };

/** version = first 12 hex of sha256(text), like the other prompts. */
function versioned(text: string): { text: string; version: string } {
  const version = createHash("sha256").update(text).digest("hex").slice(0, 12);
  return { text, version };
}

/** Role, size limit, JSON format and rules of the chat. */
export function buildChatPrompt(
  rules: string,
  lang: PromptLanguage,
  locale: Locale = DEFAULT_LOCALE,
): { text: string; version: string } {
  const t = TEXTS[locale];
  return versioned(
    [t.role(lang, CHAT_MAX_CHARS), t.format, t.rulesIntro, rules].join("\n\n"),
  );
}

/** The prompt that shapes the text of an answer into a suggestion. */
export function buildStructurePrompt(
  rules: string,
  lang: PromptLanguage,
  locale: Locale = DEFAULT_LOCALE,
): { text: string; version: string } {
  const t = TEXTS[locale];
  return versioned(
    [t.structureRole(lang), t.structureFormat, t.rulesIntro, rules].join(
      "\n\n",
    ),
  );
}

/** The parent can be a whole file: past this size it is cut, to keep the call cheap. */
const PARENT_MAX_CHARS = 8000;

/** `12 | code`, with the real line numbers of the file. */
function numbered(code: string, start: number): string {
  return code
    .split("\n")
    .map((line, i) => `${start + i} | ${line}`)
    .join("\n");
}

/** What the chat reads about the node: its labels, its parent and its code. */
export function chatContextText(
  ctx: ChatContext,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const words = wordsOf(locale);
  const list = (names: string[]) => names.join(", ") || words.none;
  const parent = ctx.parent && [
    `${TEXTS[locale].parent}: ${ctx.parent.name} (${words.kinds[ctx.parent.kind]})`,
    words.code,
    numbered(
      ctx.parent.code.slice(0, PARENT_MAX_CHARS),
      ctx.parent.range.start,
    ),
  ];
  return [
    `${words.node}: ${ctx.nodeName}`,
    `${words.type}: ${words.kinds[ctx.nodeKind]}`,
    `${words.calls}: ${list(ctx.calls)}`,
    `${words.calledBy}: ${list(ctx.calledBy)}`,
    words.code,
    numbered(ctx.code, ctx.range.start),
    ...(parent ?? []),
  ].join("\n");
}
