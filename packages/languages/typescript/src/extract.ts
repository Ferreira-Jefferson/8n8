import type { Graph } from "@code2n8n/model";
import { buildGraph } from "./build-graph";
import { markSyntaxErrors } from "./errors";
import { parsers } from "./parse";

/**
 * Graph of a pasted snippet. It is read as TypeScript; when that has a
 * syntax error and TSX reads it clean (JSX, `<T>x` casts), TSX wins.
 */
export function extractSnippet(source: string): Graph {
  let tree = parsers.typescript.parse(source);
  if (!tree) throw new Error("tree-sitter could not parse the source");
  if (tree.rootNode.hasError) {
    const tsx = parsers.tsx.parse(source);
    if (tsx && !tsx.rootNode.hasError) {
      tree.delete();
      tree = tsx;
    } else {
      tsx?.delete();
    }
  }
  try {
    return markSyntaxErrors(tree, buildGraph(tree));
  } finally {
    tree.delete();
  }
}
