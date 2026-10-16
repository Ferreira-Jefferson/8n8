import type { ExplainKind, Locale } from "@8n8/model";

/** The labels of the user turns the LLM reads, and the problems it reads back, in the language of the system. */
export interface Words {
  node: string;
  type: string;
  name: string;
  calls: string;
  calledBy: string;
  none: string;
  code: string;
  neighbours: string;
  items: string;
  docstring: string;
  redraftHeader: string;
  redraftFooter: string;
  /** The first suggestion when the docstring does not reflect the code. */
  docstringCommand: (reason: string) => string;
  docstringReason: string;
  notJudged: string;
  notShown: string;
  noEvidence: string;
  evidenceOutside: string;
  numberAbsent: (n: string) => string;
  unitAbsent: (unit: string) => string;
  identifierAbsent: (name: string) => string;
  titleTooLong: (words: number, max: number) => string;
  kinds: Record<ExplainKind, string>;
}

const PT: Words = {
  node: "Nó",
  type: "Tipo",
  name: "Nome",
  calls: "Chama",
  calledBy: "Chamado por",
  none: "nenhum",
  code: "Código:",
  neighbours: "Vizinhos",
  items: "Itens:",
  docstring:
    "Docstring (pode estar desatualizada; não use para resumir; compare com o código):",
  redraftHeader: "Problemas encontrados:",
  redraftFooter: "Reescreva o JSON inteiro sem essas afirmações.",
  docstringCommand: (reason) => `Atualize a docstring: ${reason}`,
  docstringReason: "A docstring não reflete o que o código faz.",
  notJudged: "o revisor não julgou este item",
  notShown: "o código não mostra isso",
  noEvidence: "sem linha de evidência",
  evidenceOutside: "linha de evidência fora do nó",
  numberAbsent: (n) => `o número ${n} não aparece no código`,
  unitAbsent: (unit) => `a unidade ${unit} não aparece no código`,
  identifierAbsent: (name) =>
    `o identificador ${name} não aparece no código nem nos vizinhos`,
  titleTooLong: (words, max) =>
    `o título tem ${words} palavras, mais de ${max}`,
  kinds: {
    function: "função",
    class: "classe",
    module: "código solto",
    code: "passo de código",
    call: "chamada de função",
    external: "chamada externa",
    condition: "condição",
    loop: "laço",
    block: "bloco",
    return: "retorno",
  },
};

const EN: Words = {
  node: "Node",
  type: "Type",
  name: "Name",
  calls: "Calls",
  calledBy: "Called by",
  none: "none",
  code: "Code:",
  neighbours: "Neighbours",
  items: "Items:",
  docstring:
    "Docstring (it may be out of date; do not use it to summarize; compare it with the code):",
  redraftHeader: "Problems found:",
  redraftFooter: "Rewrite the whole JSON without these claims.",
  docstringCommand: (reason) => `Update the docstring: ${reason}`,
  docstringReason: "The docstring does not reflect what the code does.",
  notJudged: "the reviewer did not judge this item",
  notShown: "the code does not show this",
  noEvidence: "no evidence line",
  evidenceOutside: "evidence line outside the node",
  numberAbsent: (n) => `the number ${n} does not appear in the code`,
  unitAbsent: (unit) => `the unit ${unit} does not appear in the code`,
  identifierAbsent: (name) =>
    `the identifier ${name} does not appear in the code or in the neighbours`,
  titleTooLong: (words, max) =>
    `the title has ${words} words, more than ${max}`,
  kinds: {
    function: "function",
    class: "class",
    module: "loose code",
    code: "code step",
    call: "function call",
    external: "external call",
    condition: "condition",
    loop: "loop",
    block: "block",
    return: "return",
  },
};

const WORDS: Record<Locale, Words> = { "pt-BR": PT, en: EN };

export const wordsOf = (locale: Locale): Words => WORDS[locale];
