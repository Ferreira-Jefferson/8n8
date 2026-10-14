import { createRequire } from "node:module";
import { Language, Parser } from "web-tree-sitter";

let python: Promise<Language> | undefined;

function loadPython(): Promise<Language> {
  const wasm = createRequire(import.meta.url).resolve(
    "tree-sitter-python/tree-sitter-python.wasm",
  );
  return Parser.init().then(() => Language.load(wasm));
}

/** Initializes tree-sitter and loads the Python grammar once per process. */
export async function loadPythonParser(): Promise<Parser> {
  python ??= loadPython();
  const language = await python;
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}
