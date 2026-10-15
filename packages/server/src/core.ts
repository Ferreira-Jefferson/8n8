import {
  buildReviewerPrompt,
  buildStepSummaryPrompt,
  buildSuggestionsPrompt,
  buildSummaryPrompt,
  buildTitlePrompt,
  buildTitleReviewerPrompt,
  createSuggestionsCache,
  createSummaryCache,
  createTitleCache,
  type ExplainDeps,
  type PromptLanguage,
  suggestNode,
  summarizeNode,
  type TitleDeps,
  titleNodes,
} from "@8n8/explain";
import { type FolderRead, type ReadFilter, readSourceFolder } from "@8n8/input";
import { pythonPlugin } from "@8n8/lang-python";
import { typescriptPlugin } from "@8n8/lang-typescript";
import { linkProject } from "@8n8/links";
import { resolveLlmConfig } from "@8n8/llm";
import type {
  ExplainPart,
  ExplainRequest,
  ExplainResponse,
  LanguagePlugin,
  TitleItem,
  TitleRequest,
  TitlesResponse,
} from "@8n8/model";
import { analyzeProject } from "@8n8/project";
import type { Hono } from "hono";
import { createApp, type ProjectRead } from "./app";
import { type History, openHistory } from "./history";
import { createPicker } from "./pick-path";
import {
  createSettingsService,
  type LlmSetup,
  type SettingsStore,
} from "./settings";

const DEFAULT_PORT = 4317;

export interface ComposeDeps {
  /** The client and config of the current settings, asked on every request (CFG-17). */
  llm: () => Promise<LlmSetup>;
  /** The languages the server reads: each one gets its own prompts. */
  plugins: LanguagePlugin[];
  ptsRules: string;
  cacheDir: string;
}

/** Wires summarizeNode and suggestNode with the current client, provider and models (CORE-19, CORE-21, FID-15, CFG-17). */
export function composeExplain(
  env: Record<string, string | undefined>,
  deps: ComposeDeps,
): (
  part: ExplainPart,
  req: ExplainRequest,
  options: { cachedOnly: boolean },
) => Promise<ExplainResponse<unknown>> {
  const dir = env.APP8N8_CACHE_DIR || deps.cacheDir;
  const caches = {
    summaryCache: createSummaryCache(dir),
    suggestionsCache: createSuggestionsCache(dir),
  };
  // One set of prompts per language: a request picks its set by `language` (6.1-6.3).
  const byLanguage = new Map(
    deps.plugins.map((plugin) => {
      const lang = promptLanguageOf(plugin);
      return [
        plugin.id,
        {
          prompts: {
            summary: buildSummaryPrompt(deps.ptsRules, lang),
            stepSummary: buildStepSummaryPrompt(deps.ptsRules, lang),
            suggestions: buildSuggestionsPrompt(deps.ptsRules, lang),
          },
          reviewer: buildReviewerPrompt(lang),
        },
      ];
    }),
  );
  return async (part, req, options) => {
    const prompts = byLanguage.get(req.language);
    if (!prompts) return noPrompt(req.language);
    const { client, config } = await deps.llm();
    const explainDeps: ExplainDeps = {
      ...caches,
      ...prompts,
      llm: client,
      provider: config.provider,
      model: config.model,
      reviewModel: config.reviewModel,
    };
    return part === "summary"
      ? summarizeNode(req, explainDeps, options)
      : suggestNode(req, explainDeps, options);
  };
}

/** Wires titleNodes with the same client, provider, models and cache folder rules as composeExplain; titles live in `<cache>/titles` (VID-14, VID-17). */
export function composeTitles(
  env: Record<string, string | undefined>,
  deps: ComposeDeps,
): (req: TitleRequest) => Promise<TitlesResponse> {
  const cache = createTitleCache(env.APP8N8_CACHE_DIR || deps.cacheDir);
  const byLanguage = new Map(
    deps.plugins.map((plugin) => {
      const lang = promptLanguageOf(plugin);
      return [
        plugin.id,
        {
          prompt: buildTitlePrompt(deps.ptsRules, lang),
          reviewer: buildTitleReviewerPrompt(lang),
        },
      ];
    }),
  );
  return async (req) => {
    const { client, config } = await deps.llm();
    // A project may mix languages: each group goes with the prompts of its own language.
    const groups = new Map<string, TitleItem[]>();
    for (const item of req.items) {
      groups.set(item.language, [...(groups.get(item.language) ?? []), item]);
    }
    const answers = new Map<string, TitlesResponse>();
    for (const [language, items] of groups) {
      const prompts = byLanguage.get(language);
      const titleDeps: TitleDeps | undefined = prompts && {
        ...prompts,
        llm: client,
        cache,
        provider: config.provider,
        model: config.model,
        reviewModel: config.reviewModel,
      };
      answers.set(
        language,
        titleDeps
          ? await titleNodes({ items }, titleDeps)
          : { ...noPrompt(language), titles: [] },
      );
    }
    return mergeTitles(req.items, answers);
  };
}

/** The prompt of a language reads only its name and its comment prefix. */
function promptLanguageOf(plugin: LanguagePlugin): PromptLanguage {
  return { label: plugin.label, commentPrefix: plugin.commentPrefix };
}

/** A request for a language no plugin serves: an error, never a guess (the server only builds requests for its plugins). */
function noPrompt(language: string): { status: "error"; message: string } {
  return {
    status: "error",
    message: `Não há prompt para a linguagem ${language}.`,
  };
}

/** The titles of every group, in the order of the items; the first error wins, then the first no-key. */
function mergeTitles(
  items: TitleItem[],
  answers: Map<string, TitlesResponse>,
): TitlesResponse {
  const byNode = new Map(
    [...answers.values()].flatMap((a) => a.titles).map((t) => [t.nodeId, t]),
  );
  const titles = items.flatMap((item) => byNode.get(item.nodeId) ?? []);
  const all = [...answers.values()];
  const failed = all.find((a) => a.status === "error");
  if (failed?.status === "error") {
    return { status: "error", message: failed.message, titles };
  }
  if (all.some((a) => a.status === "no-key")) {
    return { status: "no-key", titles };
  }
  return { status: "ok", titles };
}

/** Port from APP8N8_PORT when it is a valid port number, else 4317. */
export function resolvePort(env: Record<string, string | undefined>): number {
  const raw = env.APP8N8_PORT ?? "";
  const port = Number(raw);
  return /^\d+$/.test(raw) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
}

/** The languages the server knows; a new language is one more entry. */
export const languagePlugins: LanguagePlugin[] = [
  pythonPlugin,
  typescriptPlugin,
];

/** Reads the files of the plugins' extensions and maps them: the project sets `graph.project` (PROJ-01, PROJ-05, PROJ-06, PROJ-07). */
export function composeReadProject(
  read: (path: string, filter: ReadFilter) => Promise<FolderRead>,
  plugins: LanguagePlugin[],
): (path: string, include?: string[]) => Promise<ProjectRead> {
  const filter: ReadFilter = {
    extensions: plugins.flatMap((p) => p.extensions),
    ignoredDirs: plugins.flatMap((p) => p.ignoredDirs),
  };
  return async (path, include = []) => {
    const folder = await read(path, { ...filter, include });
    if (folder.kind === "not-found") return folder;
    const { name, root, files, ignored } = folder;
    const { graph: built, offers, requests } = analyzeProject(files, plugins);
    // Wires between languages (D3, D4); the nodes stay as the plugins made them.
    const { edges: links } = linkProject({
      offers,
      requests,
      nodes: built.nodes,
    });
    const known = new Set(built.edges.map((e) => e.id));
    const graph = {
      ...built,
      edges: [...built.edges, ...links.filter((e) => !known.has(e.id))],
      project: { name },
    };
    return { kind: "ok", root, response: { name, graph, files, ignored } };
  };
}

/** The server listens on loopback only (PROJ-08). */
export function listenOptions(port: number): {
  port: number;
  hostname: string;
} {
  return { port, hostname: "127.0.0.1" };
}

/** The history is a convenience: when the file cannot open, the app runs without it. */
function openHistoryOrWarn(path: string): History | undefined {
  try {
    return openHistory(path);
  } catch (err) {
    console.error("histórico: não abriu o banco", err);
    return undefined;
  }
}

/** Everything the core needs; it never reads the process environment (DIST-13). */
export interface CoreOptions {
  /** LLM variables (resolveLlmConfig) and APP8N8_CACHE_DIR; the host passes its environment. */
  env: Record<string, string | undefined>;
  /** The Português Técnico Simplificado rules the prompts carry. */
  ptsRules: string;
  /** The explain cache folder when APP8N8_CACHE_DIR is unset. */
  cacheDir: string;
  /** The history database file; undefined runs without history. */
  historyFile: string | undefined;
  /** The port the Host guard accepts. */
  port: number;
  /** The session token of the API (DIST-20). */
  token: string;
  /** Where the host keeps the LLM settings between runs (CFG-18). */
  settings: SettingsStore;
}

/** The whole app, built from explicit options: the host decides where data lives and opens the port (AD-022). */
export function createCore(options: CoreOptions): Hono {
  // An unknown provider in the environment fails at startup, naming the known ones.
  resolveLlmConfig(options.env);
  const settings = createSettingsService(options.env, options.settings);
  const compose = {
    llm: () => settings.llm(),
    plugins: languagePlugins,
    ptsRules: options.ptsRules,
    cacheDir: options.cacheDir,
  };
  return createApp({
    plugins: languagePlugins,
    explain: composeExplain(options.env, compose),
    titles: composeTitles(options.env, compose),
    readProject: composeReadProject(readSourceFolder, languagePlugins),
    pick: createPicker(),
    history:
      options.historyFile === undefined
        ? undefined
        : openHistoryOrWarn(options.historyFile),
    port: options.port,
    token: options.token,
    settings,
  });
}
