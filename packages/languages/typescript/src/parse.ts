import { createRequire } from "node:module";
import { loadParser as loadGrammar } from "@8n8/lang-treesitter";
import type { Parser } from "web-tree-sitter";

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
