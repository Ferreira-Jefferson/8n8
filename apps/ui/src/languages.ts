import type { LanguageInfo, SnippetLanguage } from "@8n8/model";
import { defaultT, type Translate } from "./i18n";

/** ".py", ".py e .ts", ".py, .ts e .js": the list in order, with the word before the last one. */
export function listExtensions(extensions: string[], word = "e"): string {
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
  t: Translate = defaultT,
): string {
  const ext = languages.find((l) => l.id === language?.id)?.extensions[0];
  return `${t("snippet.file")}${ext ?? ""}`;
}

/** What the folder field says the app reads. */
export function readsText(
  languages: LanguageInfo[],
  t: Translate = defaultT,
): string {
  const list = listExtensions(allExtensions(languages), t("list.and"));
  return list === "" ? t("reads.none") : t("reads.some", { list });
}

/** What the screen says when a folder has no file to read. */
export function noFilesText(
  languages: LanguageInfo[],
  t: Translate = defaultT,
): string {
  const list = listExtensions(allExtensions(languages), t("list.or"));
  return list === "" ? t("noFiles.none") : t("noFiles.some", { list });
}
