import type {
  Graph,
  LanguageAnalysis,
  LanguagePlugin,
  SourceFile,
} from "@8n8/model";

const NO_ANALYSIS: LanguageAnalysis = {
  files: [],
  imports: [],
  offers: [],
  requests: [],
};

/** A plugin for route tests: `extract` is given, the rest has plain defaults and can be overridden. */
export function fakeLang(
  extract: (source: string) => Graph,
  over: Partial<LanguagePlugin> = {},
): LanguagePlugin {
  return {
    id: "python",
    label: "Python",
    extensions: [".py"],
    ignoredDirs: [],
    commentPrefix: "#",
    detect: () => 1,
    extract,
    analyze: (_files: SourceFile[]) => NO_ANALYSIS,
    ...over,
  };
}
