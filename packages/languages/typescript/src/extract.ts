import { markErrorLines } from "@8n8/lang-treesitter";
import type { Graph } from "@8n8/model";
import type { Tree } from "web-tree-sitter";
import { buildGraph } from "./build-graph";
import { parseRecovering, parsers } from "./parse";

/**
 * Graph of a pasted snippet. It is read as TypeScript; when that has a
 * syntax error and TSX reads it clean (JSX, `<T>x` casts), TSX wins. A
 * text that stays broken is read again with `parseRecovering`.
 */
export function extractSnippet(source: string): Graph {
  let tree: Tree | null = parsers.typescript.parse(source);
  if (!tree) throw new Error("tree-sitter could not parse the source");
  let errors: number[] = [];
  if (tree.rootNode.hasError) {
    const tsx = parsers.tsx.parse(source);
    if (tsx && !tsx.rootNode.hasError) {
      tree.delete();
      tree = tsx;
    } else {
      tsx?.delete();
      tree.delete();
      const parsed = parseRecovering(parsers.typescript, source);
      if (!parsed) throw new Error("tree-sitter could not parse the source");
      tree = parsed.tree;
      errors = parsed.errors;
    }
  }
  try {
    return markErrorLines(buildGraph(tree), errors);
  } finally {
    tree.delete();
  }
}
