import type { Extractor } from "@code2n8n/model";
import { buildGraph } from "./build-graph";
import { markSyntaxErrors } from "./errors";
import { loadPythonParser } from "./parse";

/** Deterministic Python extractor: same source, same graph, no LLM (CORE-04, 05). */
export async function createPythonExtractor(): Promise<Extractor> {
  const parser = await loadPythonParser();
  return {
    language: "python",
    extract(source) {
      const tree = parser.parse(source);
      if (!tree) throw new Error("tree-sitter could not parse the source");
      try {
        return markSyntaxErrors(tree, buildGraph(tree));
      } finally {
        tree.delete();
      }
    },
  };
}
