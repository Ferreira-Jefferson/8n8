import type { LanguagePlugin } from "@8n8/model";
import { analyzeFiles, openSlice } from "./analyze";
import { detectTypescript } from "./detect";
import { extractSnippet } from "./extract";
import { MANIFESTS } from "./modules";

/** Deterministic TypeScript plugin: same source, same graph, no LLM. */
export const typescriptPlugin: LanguagePlugin = {
  id: "typescript",
  label: "TypeScript",
  extensions: [".ts", ".tsx"],
  manifests: MANIFESTS,
  ignoredDirs: [".next", ".turbo", "bower_components"],
  commentPrefix: "//",
  detect: detectTypescript,
  extract: extractSnippet,
  analyze: analyzeFiles,
  openSlice,
  cacheVersion: "3",
};
