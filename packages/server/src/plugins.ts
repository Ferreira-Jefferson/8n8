import { pythonPlugin } from "@8n8/lang-python";
import { typescriptPlugin } from "@8n8/lang-typescript";
import type { LanguagePlugin } from "@8n8/model";

/** The languages the server knows; a new language is one more entry. Its own file, so the analysis worker loads no more than this. */
export const languagePlugins: LanguagePlugin[] = [
  pythonPlugin,
  typescriptPlugin,
];
