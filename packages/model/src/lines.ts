import type { LineRange } from "./graph";

/** Exact lines of `range` (1-based, inclusive), original indentation kept. */
export function sliceLines(source: string, range: LineRange): string {
  return source
    .split(/\r?\n/)
    .slice(range.start - 1, range.end)
    .join("\n");
}

export function syntaxErrorLabel(line: number): string {
  return `Erro de sintaxe na linha ${line}`;
}
