import { createHash } from "node:crypto";

const ROLE = `Você explica código Python para quem lê o fluxo de um programa.
Você recebe um nó (função ou classe), os nomes dos nós que ele chama, os nomes dos nós que o chamam e o código do nó com as linhas numeradas de 1 a n.
Explique só o que o código mostra. Não invente comportamento.`;

const FORMAT = `Responda só com JSON válido, sem texto fora do JSON e sem cercas de código.
O JSON tem estes campos:
- "summary": resumo do que o nó faz, em uma a três frases.
- "inputs": lista com as entradas do nó (parâmetros, arquivos, dados externos).
- "outputs": lista com as saídas do nó (retorno, efeitos, dados gravados).
- "suggestions": lista de 0 a 5 sugestões de melhoria. Cada sugestão tem "command" (a ação, no imperativo), "reason" (o motivo), "line" (a linha do código numerado, de 1 a n) e "severity" ("alta", "media" ou "baixa").
Exemplo:
{"summary":"Calcula o frete a partir do peso.","inputs":["peso"],"outputs":["valor do frete"],"suggestions":[{"command":"Valide se peso é positivo.","reason":"Peso negativo gera frete negativo.","line":2,"severity":"media"}]}`;

/** System prompt with role, JSON format and PTS rules; version = first 12 hex of sha256(text) (CORE-16, CORE-18). */
export function buildSystemPrompt(ptsRules: string): {
  text: string;
  version: string;
} {
  const text = `${ROLE}\n\n${FORMAT}\n\nEscreva os textos do JSON com as regras abaixo.\n\n${ptsRules}`;
  const version = createHash("sha256").update(text).digest("hex").slice(0, 12);
  return { text, version };
}
