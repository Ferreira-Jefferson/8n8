import { createRequire } from "node:module";
import { loadParser } from "@8n8/lang-treesitter";
import type { Parser } from "web-tree-sitter";

const wasm = createRequire(import.meta.url).resolve(
  "tree-sitter-python/tree-sitter-python.wasm",
);

/** Initializes tree-sitter and loads the Python grammar once per process. */
export function loadPythonParser(): Promise<Parser> {
  return loadParser(wasm);
}
