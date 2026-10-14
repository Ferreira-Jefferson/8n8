import { Language, Parser } from "web-tree-sitter";

let initialized: Promise<void> | undefined;
const languages = new Map<string, Promise<Language>>();

/** Loads the grammar at `wasmPath` once per process; `Parser.init()` runs once too. */
export function loadLanguage(wasmPath: string): Promise<Language> {
  initialized ??= Parser.init();
  let language = languages.get(wasmPath);
  if (language === undefined) {
    language = initialized.then(() => Language.load(wasmPath));
    languages.set(wasmPath, language);
  }
  return language;
}

/** A new parser set to the grammar at `wasmPath`. */
export async function loadParser(wasmPath: string): Promise<Parser> {
  const language = await loadLanguage(wasmPath);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}
