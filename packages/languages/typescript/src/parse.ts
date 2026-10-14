import { createRequire } from "node:module";
import { Language, Parser } from "web-tree-sitter";

export type Dialect = "typescript" | "tsx";

const languages = new Map<Dialect, Promise<Language>>();

function loadLanguage(dialect: Dialect): Promise<Language> {
  const wasm = createRequire(import.meta.url).resolve(
    `tree-sitter-typescript/tree-sitter-${dialect}.wasm`,
  );
  return Parser.init().then(() => Language.load(wasm));
}

/** Initializes tree-sitter and loads a TypeScript grammar once per process. */
export async function loadParser(dialect: Dialect): Promise<Parser> {
  let language = languages.get(dialect);
  if (language === undefined) {
    language = loadLanguage(dialect);
    languages.set(dialect, language);
  }
  const loaded = await language;
  const parser = new Parser();
  parser.setLanguage(loaded);
  return parser;
}

/** Both grammars, loaded once at import: `LanguagePlugin` methods are synchronous. */
export const parsers: Record<Dialect, Parser> = {
  typescript: await loadParser("typescript"),
  tsx: await loadParser("tsx"),
};
