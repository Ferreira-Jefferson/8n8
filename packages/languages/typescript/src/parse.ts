import { createRequire } from "node:module";
import {
  loadParser as loadGrammar,
  treeErrorLines,
} from "@8n8/lang-treesitter";
import type { Parser, Tree } from "web-tree-sitter";

export type Dialect = "typescript" | "tsx";

/** Initializes tree-sitter and loads a TypeScript grammar once per process. */
export function loadParser(dialect: Dialect): Promise<Parser> {
  const wasm = createRequire(import.meta.url).resolve(
    `tree-sitter-typescript/tree-sitter-${dialect}.wasm`,
  );
  return loadGrammar(wasm);
}

/** Both grammars, loaded once at import: `LanguagePlugin` methods are synchronous. */
export const parsers: Record<Dialect, Parser> = {
  typescript: await loadParser("typescript"),
  tsx: await loadParser("tsx"),
};

/** A line that starts a top-level declaration, with no indentation. */
const DECLARATION =
  /^(?:export|import|function|async\s+function|class|abstract\s+class|const|let|var|interface|type|enum|declare|namespace)\b/;

/** At most this many parses again for one text: each one blanks at least one error. */
const MAX_ROUNDS = 20;

/** `text` with the characters from `from` to `to` turned into spaces; the line breaks stay, so every line keeps its number. */
function blank(text: string, from: number, to: number): string {
  return (
    text.slice(0, from) +
    text.slice(from, to).replace(/[^\r\n]/g, " ") +
    text.slice(to)
  );
}

/**
 * Parses `source`, giving back the declarations an error swallowed.
 * tree-sitter may put everything after a broken declaration into one
 * top-level ERROR node. The text of that node, up to the next line that
 * starts a declaration, becomes spaces, and the text is parsed again.
 * `errors` has the 1-based syntax error lines: the first line of each
 * blanked part, and the errors of the final tree.
 */
export function parseRecovering(
  parser: Parser,
  source: string,
): { tree: Tree; errors: number[] } | null {
  let text = source;
  let tree = parser.parse(text);
  if (tree === null) return null;
  const lines = source.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const cut: number[] = [];
  for (let round = 0; round < MAX_ROUNDS && tree.rootNode.hasError; round++) {
    let next = text;
    for (const node of tree.rootNode.namedChildren) {
      if (node.type !== "ERROR") continue;
      const first = node.startPosition.row;
      let row = first + 1;
      while (row <= node.endPosition.row && !DECLARATION.test(lines[row] ?? ""))
        row++;
      if (row > node.endPosition.row) continue;
      next = blank(next, node.startIndex, starts[row] ?? next.length);
      cut.push(first + 1);
    }
    if (next === text) break;
    const again = parser.parse(next);
    if (again === null) break;
    tree.delete();
    tree = again;
    text = next;
  }
  const errors = [...new Set([...cut, ...treeErrorLines(tree.rootNode)])];
  return { tree, errors: errors.sort((a, b) => a - b) };
}
