/** What a prompt needs to know about the language of the code: plain text, never a plugin (the explain package imports none). */
export interface PromptLanguage {
  /** Name for the prompt. Ex.: `Python`. */
  label: string;
  /** Start of a line comment. Ex.: `#`, `//`. */
  commentPrefix: string;
}

/** The line that takes the place of a masked docstring: `# docstring omitida`. */
export function docstringOmitted(commentPrefix: string): string {
  return `${commentPrefix} docstring omitida`;
}
