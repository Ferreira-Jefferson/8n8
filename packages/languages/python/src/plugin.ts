import type { Extractor, LanguagePlugin } from "@8n8/model";
import { analyzeFiles } from "./analyze";
import { buildGraph } from "./build-graph";
import { detectPython } from "./detect";
import { markSyntaxErrors } from "./errors";
import { loadPythonParser } from "./parse";

// The plugin contract is synchronous, and loading the grammar is not: the
// module waits for it once, so `pythonPlugin` is ready to use when imported.
const parser = await loadPythonParser();

/** Deterministic Python plugin: same source, same graph, no LLM (CORE-04, 05). */
export const pythonPlugin: LanguagePlugin = {
  id: "python",
  label: "Python",
  extensions: [".py"],
  ignoredDirs: [
    ".venv",
    "venv",
    "__pycache__",
    "site-packages",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
  ],
  commentPrefix: "#",
  detect: detectPython,
  extract(source) {
    const tree = parser.parse(source);
    if (!tree) throw new Error("tree-sitter could not parse the source");
    try {
      return markSyntaxErrors(tree, buildGraph(tree));
    } finally {
      tree.delete();
    }
  },
  analyze: (files) => analyzeFiles(parser, files),
};

/** Thin wrapper over the plugin, kept while the server still builds an `Extractor` (step 6 removes it). */
export async function createPythonExtractor(): Promise<Extractor> {
  return { language: pythonPlugin.id, extract: pythonPlugin.extract };
}
