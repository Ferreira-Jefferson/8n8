import type { LanguagePlugin } from "@code2n8n/model";
import { analyzeFiles } from "./analyze";
import { detectTypescript } from "./detect";
import { extractSnippet } from "./extract";

/** Deterministic TypeScript plugin: same source, same graph, no LLM. */
export const typescriptPlugin: LanguagePlugin = {
  id: "typescript",
  label: "TypeScript",
  extensions: [".ts", ".tsx"],
  ignoredDirs: [".next", "coverage"],
  commentPrefix: "//",
  detect: detectTypescript,
  extract: extractSnippet,
  analyze: analyzeFiles,
};
