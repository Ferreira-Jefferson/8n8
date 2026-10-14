import type { Graph } from "./graph";

/** One language the server reads, as `GET /api/languages` lists it. */
export interface LanguageInfo {
  id: string;
  label: string;
  /** With the dot, lowercase: `[".py"]`. */
  extensions: string[];
}

/** The language of a pasted snippet, picked by the server (a snippet has no extension). */
export interface SnippetLanguage {
  id: string;
  label: string;
  /** True when the best score is low or two languages tie: the screen warns "linguagem incerta". */
  uncertain: boolean;
}

/** `POST /api/graph` */
export interface GraphResponse {
  graph: Graph;
  language: SnippetLanguage;
}

/** `GET /api/languages` */
export interface LanguagesResponse {
  languages: LanguageInfo[];
}
