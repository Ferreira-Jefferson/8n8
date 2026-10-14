import type { LanguageInfo, SnippetLanguage } from "@code2n8n/model";

/** ".py", ".py e .ts", ".py, .ts e .js": the list in order, with the word before the last one. */
export function listExtensions(
  extensions: string[],
  word: "e" | "ou" = "e",
): string {
  if (extensions.length <= 1) return extensions.join("");
  return `${extensions.slice(0, -1).join(", ")} ${word} ${extensions.at(-1)}`;
}

/** The extensions of every language, in the list's order. */
function allExtensions(languages: LanguageInfo[]): string[] {
  return languages.flatMap((l) => l.extensions);
}

/** "trecho.py": the snippet's name takes the first extension of its language; with no known language it is "trecho". */
export function snippetFileName(
  language: SnippetLanguage | undefined,
  languages: LanguageInfo[],
): string {
  const ext = languages.find((l) => l.id === language?.id)?.extensions[0];
  return `trecho${ext ?? ""}`;
}

/** What the folder field says the app reads. */
export function readsText(languages: LanguageInfo[]): string {
  const list = listExtensions(allExtensions(languages));
  return list === ""
    ? "O 8n8 lê os arquivos de código da pasta e das subpastas."
    : `O 8n8 lê os arquivos ${list} da pasta e das subpastas.`;
}

/** What the screen says when a folder has no file to read. */
export function noFilesText(languages: LanguageInfo[]): string {
  const list = listExtensions(allExtensions(languages), "ou");
  return list === ""
    ? "Nenhum arquivo de código encontrado na pasta."
    : `Nenhum arquivo ${list} encontrado na pasta.`;
}
