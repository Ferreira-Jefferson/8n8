import { DEFAULT_LOCALE, type Locale } from "@8n8/model";

/** What a prompt needs to know about the language of the code: plain text, never a plugin (the explain package imports none). */
export interface PromptLanguage {
  /** Name for the prompt. Ex.: `Python`. */
  label: string;
  /** Start of a line comment. Ex.: `#`, `//`. */
  commentPrefix: string;
}

const OMITTED: Record<Locale, string> = {
  "pt-BR": "docstring omitida",
  en: "docstring omitted",
};

/** The line that takes the place of a masked docstring: `# docstring omitida`. */
export function docstringOmitted(
  commentPrefix: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return `${commentPrefix} ${OMITTED[locale]}`;
}
