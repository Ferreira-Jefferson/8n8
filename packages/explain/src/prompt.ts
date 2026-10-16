import { createHash } from "node:crypto";
import { DEFAULT_LOCALE, type Locale } from "@8n8/model";
import { docstringOmitted, type PromptLanguage } from "./language";

/** The words of one prompt, in one language of the system (the rules text comes apart, from the PTS or STE file). */
interface PromptTexts {
  rules: (lang: PromptLanguage, what: string, locale: Locale) => string;
  summaryRole: (lang: PromptLanguage, rules: string) => string;
  stepRole: (lang: PromptLanguage, rules: string) => string;
  suggestionsRole: (lang: PromptLanguage, rules: string) => string;
  explainOnly: string;
  suggestOnly: string;
  summaryFormat: (summary: string) => string;
  summaryField: string;
  stepField: string;
  suggestionsFormat: string;
  rulesIntro: string;
}

const PT: PromptTexts = {
  rules: (lang, what, locale) => `${what}
O código chega sem a docstring (aparece só \`${docstringOmitted(lang.commentPrefix, locale)}\`).
Cite entre crases cada identificador do código (variável, parâmetro, função, classe ou módulo), como \`peso\` ou \`requests.get\`.
Não escreva número nem unidade (como kg, %, R$ ou segundos) que não aparece no código.`,
  summaryRole: (lang, rules) =>
    `Você explica código ${lang.label} para quem lê o fluxo de um programa.
Você recebe um nó (função ou classe), os nomes dos nós que ele chama, os nomes dos nós que o chamam e o código do nó com as linhas numeradas de 1 a n.
${rules}`,
  stepRole: (lang, rules) =>
    `Você explica um passo de dentro de uma função ${lang.label} para quem lê o fluxo de um programa.
Você recebe o passo, os nomes dos nós que ele chama e o código do passo com as linhas numeradas de 1 a n.
${rules}`,
  suggestionsRole: (lang, rules) =>
    `Você sugere melhorias para um código ${lang.label}, para quem revisa o fluxo de um programa.
Você recebe um nó (função, classe ou passo), os nomes dos nós que ele chama, os nomes dos nós que o chamam e o código do nó com as linhas numeradas de 1 a n.
${rules}`,
  explainOnly:
    "Explique só o que o código mostra. Não invente comportamento. O resumo descreve só o que o código faz, nunca o que uma docstring diz.",
  suggestOnly:
    "Sugira só melhorias para problemas que o código mostra. Não invente comportamento.",
  summaryFormat: (
    summary,
  ) => `Responda só com JSON válido, sem texto fora do JSON e sem cercas de código.
O JSON tem estes campos:
- "summary": ${summary}
- "inputs": lista com as entradas do nó (parâmetros, arquivos, dados externos).
- "outputs": lista com as saídas do nó (retorno, efeitos, dados gravados).
Exemplo:
{"summary":"Calcula o frete a partir do peso.","inputs":["peso"],"outputs":["valor do frete"]}`,
  summaryField: "resumo do que o nó faz, em uma a três frases.",
  stepField: "resumo do que o passo faz, em uma ou duas frases.",
  suggestionsFormat: `Responda só com JSON válido, sem texto fora do JSON e sem cercas de código.
O JSON tem estes campos:
- "suggestions": lista de 0 a 5 sugestões de melhoria. Cada sugestão tem "command" (a ação, no imperativo), "reason" (o motivo), "line" (a linha do código numerado, de 1 a n) e "severity" ("alta", "media" ou "baixa").
- "docstring" (opcional): peça só quando a mensagem tem um bloco "Docstring". É um objeto {"reflects": true ou false, "reason": "..."}. "reflects" é false quando a docstring diz algo que o código não faz, omite um comportamento principal ou cita parâmetros ou retornos errados. "reason" é uma frase curta que cita entre crases os identificadores do código.
Exemplo:
{"suggestions":[{"command":"Valide se peso é positivo.","reason":"Peso negativo gera frete negativo.","line":2,"severity":"media"}]}`,
  rulesIntro: "Escreva os textos do JSON com as regras abaixo.",
};

const EN: PromptTexts = {
  rules: (lang, what, locale) => `${what}
The code arrives without the docstring (only \`${docstringOmitted(lang.commentPrefix, locale)}\` shows).
Quote each identifier of the code in backticks (variable, parameter, function, class or module), like \`weight\` or \`requests.get\`.
Do not write a number or a unit (like kg, %, $ or seconds) that does not appear in the code.`,
  summaryRole: (lang, rules) =>
    `You explain ${lang.label} code to someone who reads the flow of a program.
You receive a node (function or class), the names of the nodes it calls, the names of the nodes that call it and the code of the node with lines numbered from 1 to n.
${rules}`,
  stepRole: (lang, rules) =>
    `You explain a step inside a ${lang.label} function to someone who reads the flow of a program.
You receive the step, the names of the nodes it calls and the code of the step with lines numbered from 1 to n.
${rules}`,
  suggestionsRole: (lang, rules) =>
    `You suggest improvements for ${lang.label} code, for someone who reviews the flow of a program.
You receive a node (function, class or step), the names of the nodes it calls, the names of the nodes that call it and the code of the node with lines numbered from 1 to n.
${rules}`,
  explainOnly:
    "Explain only what the code shows. Do not invent behavior. The summary describes only what the code does, never what a docstring says.",
  suggestOnly:
    "Suggest only improvements for problems the code shows. Do not invent behavior.",
  summaryFormat: (
    summary,
  ) => `Answer with valid JSON only, with no text outside the JSON and no code fences.
The JSON has these fields:
- "summary": ${summary}
- "inputs": list with the inputs of the node (parameters, files, external data).
- "outputs": list with the outputs of the node (return value, effects, data written).
Example:
{"summary":"Calculates the shipping from the weight.","inputs":["weight"],"outputs":["shipping value"]}`,
  summaryField: "summary of what the node does, in one to three sentences.",
  stepField: "summary of what the step does, in one or two sentences.",
  suggestionsFormat: `Answer with valid JSON only, with no text outside the JSON and no code fences.
The JSON has these fields:
- "suggestions": list of 0 to 5 improvement suggestions. Each suggestion has "command" (the action, in the imperative), "reason" (the reason), "line" (the line of the numbered code, from 1 to n) and "severity" (write exactly one of "alta" for high, "media" for medium or "baixa" for low).
- "docstring" (optional): ask for it only when the message has a "Docstring" block. It is an object {"reflects": true or false, "reason": "..."}. "reflects" is false when the docstring says something the code does not do, omits a main behavior or names wrong parameters or returns. "reason" is a short sentence that quotes the identifiers of the code in backticks.
Example:
{"suggestions":[{"command":"Validate that weight is positive.","reason":"A negative weight gives a negative shipping.","line":2,"severity":"media"}]}`,
  rulesIntro: "Write the texts of the JSON with the rules below.",
};

const TEXTS: Record<Locale, PromptTexts> = { "pt-BR": PT, en: EN };

/** Role, JSON format and rules; version = first 12 hex of sha256(text) (CORE-16, CORE-18). The rules are the PTS or the STE of the locale. */
function versioned(
  role: string,
  format: string,
  rules: string,
  rulesIntro: string,
): { text: string; version: string } {
  const text = `${role}\n\n${format}\n\n${rulesIntro}\n\n${rules}`;
  const version = createHash("sha256").update(text).digest("hex").slice(0, 12);
  return { text, version };
}

/** Summary of a function, class or loose code: summary, inputs and outputs only (CFG-03). */
export function buildSummaryPrompt(
  rules: string,
  lang: PromptLanguage,
  locale: Locale = DEFAULT_LOCALE,
): { text: string; version: string } {
  const t = TEXTS[locale];
  return versioned(
    t.summaryRole(lang, t.rules(lang, t.explainOnly, locale)),
    t.summaryFormat(t.summaryField),
    rules,
    t.rulesIntro,
  );
}

/** Summary of a step inside a function, in one or two sentences (VID-28, CFG-03). */
export function buildStepSummaryPrompt(
  rules: string,
  lang: PromptLanguage,
  locale: Locale = DEFAULT_LOCALE,
): { text: string; version: string } {
  const t = TEXTS[locale];
  return versioned(
    t.stepRole(lang, t.rules(lang, t.explainOnly, locale)),
    t.summaryFormat(t.stepField),
    rules,
    t.rulesIntro,
  );
}

/** Suggestions of any node, plus the docstring verdict when the message has one (CFG-03). */
export function buildSuggestionsPrompt(
  rules: string,
  lang: PromptLanguage,
  locale: Locale = DEFAULT_LOCALE,
): { text: string; version: string } {
  const t = TEXTS[locale];
  return versioned(
    t.suggestionsRole(lang, t.rules(lang, t.suggestOnly, locale)),
    t.suggestionsFormat,
    rules,
    t.rulesIntro,
  );
}
