import { createHash } from "node:crypto";
import { docstringOmitted, type PromptLanguage } from "./language";

/** The rules every part shares: only what the code shows, backticked identifiers, no invented numbers. */
const rules = (lang: PromptLanguage, what: string) => `${what}
O código chega sem a docstring (aparece só \`${docstringOmitted(lang.commentPrefix)}\`).
Cite entre crases cada identificador do código (variável, parâmetro, função, classe ou módulo), como \`peso\` ou \`requests.get\`.
Não escreva número nem unidade (como kg, %, R$ ou segundos) que não aparece no código.`;

const summaryRole = (lang: PromptLanguage) =>
  `Você explica código ${lang.label} para quem lê o fluxo de um programa.
Você recebe um nó (função ou classe), os nomes dos nós que ele chama, os nomes dos nós que o chamam e o código do nó com as linhas numeradas de 1 a n.
${rules(lang, "Explique só o que o código mostra. Não invente comportamento. O resumo descreve só o que o código faz, nunca o que uma docstring diz.")}`;

const stepRole = (lang: PromptLanguage) =>
  `Você explica um passo de dentro de uma função ${lang.label} para quem lê o fluxo de um programa.
Você recebe o passo, os nomes dos nós que ele chama e o código do passo com as linhas numeradas de 1 a n.
${rules(lang, "Explique só o que o código mostra. Não invente comportamento. O resumo descreve só o que o código faz, nunca o que uma docstring diz.")}`;

const suggestionsRole = (lang: PromptLanguage) =>
  `Você sugere melhorias para um código ${lang.label}, para quem revisa o fluxo de um programa.
Você recebe um nó (função, classe ou passo), os nomes dos nós que ele chama, os nomes dos nós que o chamam e o código do nó com as linhas numeradas de 1 a n.
${rules(lang, "Sugira só melhorias para problemas que o código mostra. Não invente comportamento.")}`;

const JSON_ONLY =
  "Responda só com JSON válido, sem texto fora do JSON e sem cercas de código.";

const summaryFormat = (summary: string) => `${JSON_ONLY}
O JSON tem estes campos:
- "summary": ${summary}
- "inputs": lista com as entradas do nó (parâmetros, arquivos, dados externos).
- "outputs": lista com as saídas do nó (retorno, efeitos, dados gravados).
Exemplo:
{"summary":"Calcula o frete a partir do peso.","inputs":["peso"],"outputs":["valor do frete"]}`;

const SUGGESTIONS_FORMAT = `${JSON_ONLY}
O JSON tem estes campos:
- "suggestions": lista de 0 a 5 sugestões de melhoria. Cada sugestão tem "command" (a ação, no imperativo), "reason" (o motivo), "line" (a linha do código numerado, de 1 a n) e "severity" ("alta", "media" ou "baixa").
- "docstring" (opcional): peça só quando a mensagem tem um bloco "Docstring". É um objeto {"reflects": true ou false, "reason": "..."}. "reflects" é false quando a docstring diz algo que o código não faz, omite um comportamento principal ou cita parâmetros ou retornos errados. "reason" é uma frase curta que cita entre crases os identificadores do código.
Exemplo:
{"suggestions":[{"command":"Valide se peso é positivo.","reason":"Peso negativo gera frete negativo.","line":2,"severity":"media"}]}`;

/** Role, JSON format and PTS rules; version = first 12 hex of sha256(text) (CORE-16, CORE-18). */
function versioned(
  role: string,
  format: string,
  ptsRules: string,
): { text: string; version: string } {
  const text = `${role}\n\n${format}\n\nEscreva os textos do JSON com as regras abaixo.\n\n${ptsRules}`;
  const version = createHash("sha256").update(text).digest("hex").slice(0, 12);
  return { text, version };
}

/** Summary of a function, class or loose code: summary, inputs and outputs only (CFG-03). */
export function buildSummaryPrompt(
  ptsRules: string,
  lang: PromptLanguage,
): { text: string; version: string } {
  return versioned(
    summaryRole(lang),
    summaryFormat("resumo do que o nó faz, em uma a três frases."),
    ptsRules,
  );
}

/** Summary of a step inside a function, in one or two sentences (VID-28, CFG-03). */
export function buildStepSummaryPrompt(
  ptsRules: string,
  lang: PromptLanguage,
): { text: string; version: string } {
  return versioned(
    stepRole(lang),
    summaryFormat("resumo do que o passo faz, em uma ou duas frases."),
    ptsRules,
  );
}

/** Suggestions of any node, plus the docstring verdict when the message has one (CFG-03). */
export function buildSuggestionsPrompt(
  ptsRules: string,
  lang: PromptLanguage,
): { text: string; version: string } {
  return versioned(suggestionsRole(lang), SUGGESTIONS_FORMAT, ptsRules);
}
