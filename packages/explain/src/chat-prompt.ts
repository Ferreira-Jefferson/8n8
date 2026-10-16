import { createHash } from "node:crypto";
import {
  CHAT_MAX_CHARS,
  type ChatContext,
  DEFAULT_LOCALE,
  type Locale,
} from "@8n8/model";
import type { PromptLanguage } from "./language";
import { wordsOf } from "./messages";

/** The words of the chat prompt, in one language of the system. */
interface ChatTexts {
  role: (lang: PromptLanguage, max: number) => string;
  rulesIntro: string;
  parent: string;
}

const PT: ChatTexts = {
  role: (lang, max) =>
    `Você conversa com quem revisa código ${lang.label}, sobre um nó do fluxo de um programa e sobre o pai dele.
Você recebe o nó, o pai inteiro, os nomes dos nós que o nó chama e dos nós que o chamam, e o código com as linhas numeradas.
Responda só sobre esse código. Se a pergunta for sobre outra coisa, diga em uma frase que você só fala deste nó e do pai dele.
Responda em texto simples, com no máximo ${max} caracteres. Vá direto ao ponto: sem introdução e sem repetir a pergunta.
Para apontar uma linha, escreva \`L12\` (a letra L e o número da linha do código numerado). Cite só linhas que existem.
Explique só o que o código mostra. Não invente comportamento. Se o código não mostra a resposta, diga isso.`,
  rulesIntro: "Escreva a resposta com as regras abaixo.",
  parent: "Pai (inteiro)",
};

const EN: ChatTexts = {
  role: (lang, max) =>
    `You talk with someone who reviews ${lang.label} code, about one node of the flow of a program and about its parent.
You receive the node, the whole parent, the names of the nodes the node calls and of the nodes that call it, and the code with numbered lines.
Answer only about this code. If the question is about something else, say in one sentence that you only talk about this node and its parent.
Answer in plain text, with at most ${max} characters. Go straight to the point: no introduction and no repeating the question.
To point at a line, write \`L12\` (the letter L and the number of the line in the numbered code). Cite only lines that exist.
Explain only what the code shows. Do not invent behavior. If the code does not show the answer, say so.`,
  rulesIntro: "Write the answer with the rules below.",
  parent: "Parent (whole)",
};

const TEXTS: Record<Locale, ChatTexts> = { "pt-BR": PT, en: EN };

/** Role, limit and rules; version = first 12 hex of sha256(text), like the other prompts. */
export function buildChatPrompt(
  rules: string,
  lang: PromptLanguage,
  locale: Locale = DEFAULT_LOCALE,
): { text: string; version: string } {
  const t = TEXTS[locale];
  const text = `${t.role(lang, CHAT_MAX_CHARS)}\n\n${t.rulesIntro}\n\n${rules}`;
  const version = createHash("sha256").update(text).digest("hex").slice(0, 12);
  return { text, version };
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
