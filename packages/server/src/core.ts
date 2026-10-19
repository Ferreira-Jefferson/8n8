import { join } from "node:path";
import {
  buildChatPrompt,
  buildReviewerPrompt,
  buildStepSummaryPrompt,
  buildStructurePrompt,
  buildSuggestionsPrompt,
  buildSummaryPrompt,
  buildTitlePrompt,
  buildTitleReviewerPrompt,
  chatNode,
  createNotesStore,
  createSuggestionsCache,
  createSummaryCache,
  createTitleCache,
  type ExplainDeps,
  type NotesStore,
  type PromptLanguage,
  structureText,
  suggestNode,
  summarizeNode,
  type TitleDeps,
  titleNodes,
} from "@8n8/explain";
import { type FolderRead, type ReadFilter, readSourceFolder } from "@8n8/input";
import { resolveLlmConfig } from "@8n8/llm";
import {
  type ChatRequest,
  type ChatResponse,
  DEFAULT_LOCALE,
  type ExplainPart,
  type ExplainRequest,
  type ExplainResponse,
  type LanguagePlugin,
  type Locale,
  type StructureRequest,
  type StructureResponse,
  type TitleItem,
  type TitleRequest,
  type TitlesResponse,
  translateSystem,
} from "@8n8/model";
import type { Hono } from "hono";
import { createApp, type ProjectRead } from "./app";
import { type History, openHistory } from "./history";
import { createPicker } from "./pick-path";
import { languagePlugins } from "./plugins";
import { type Build, buildInThread } from "./project-build";
import { BuilderLost, createProjectBuilder } from "./project-builder";
import { createProjectCache, fingerprintOf, versionOf } from "./project-cache";
import { createProjectStore } from "./project-store";
import {
  createSettingsService,
  type LlmSetup,
  type SettingsStore,
} from "./settings";

const DEFAULT_PORT = 8148;

export interface ComposeDeps {
  /** The client and config of the current settings, asked on every request (CFG-17). */
  llm: () => Promise<LlmSetup>;
  /** The languages the server reads: each one gets its own prompts. */
  plugins: LanguagePlugin[];
  /** The rules of the text the LLM writes, one file per language of the system: the PTS and the STE. */
  ptsRules: string;
  steRules: string;
  cacheDir: string;
  /** The language of the system, asked on every request; Portuguese when absent. */
  locale?: () => Promise<Locale>;
}

/** The rules the prompts carry in a language of the system. */
const rulesOf = (deps: ComposeDeps, locale: Locale): string =>
  locale === "en" ? deps.steRules : deps.ptsRules;

/** Builds a value once for each key; prompts and caches belong to a language, so a change of language reuses them. */
function memo<T>(build: (key: string) => T): (key: string) => T {
  const made = new Map<string, T>();
  return (key) => {
    if (!made.has(key)) made.set(key, build(key));
    return made.get(key) as T;
  };
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
  // One cache folder per language of the system: changing it never erases what the other wrote.
  const cachesOf = memo((locale) => ({
    summaryCache: createSummaryCache(dir, locale as Locale),
    suggestionsCache: createSuggestionsCache(dir, locale as Locale),
  }));
  // One set of prompts per code language and system language: a request picks its set by `language` (6.1-6.3).
  const promptsOf = memo((key) => {
    const [locale, id] = key.split("|") as [Locale, string];
    const plugin = deps.plugins.find((p) => p.id === id);
    if (!plugin) return undefined;
    const lang = promptLanguageOf(plugin);
    const rules = rulesOf(deps, locale);
    return {
      prompts: {
        summary: buildSummaryPrompt(rules, lang, locale),
        stepSummary: buildStepSummaryPrompt(rules, lang, locale),
        suggestions: buildSuggestionsPrompt(rules, lang, locale),
      },
      reviewer: buildReviewerPrompt(lang, locale),
    };
  });
  return async (part, req, options) => {
    const locale = (await deps.locale?.()) ?? DEFAULT_LOCALE;
    const prompts = promptsOf(`${locale}|${req.language}`);
    if (!prompts) return noPrompt(req.language, locale);
    const { client, config } = await deps.llm();
    const explainDeps: ExplainDeps = {
      ...cachesOf(locale),
      ...prompts,
      locale,
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

/** Wires chatNode with the current client, model and prompt of the language of the system and of the code (no cache: a conversation is not worth keeping). */
export function composeChat(deps: ComposeDeps): {
  chat: (req: ChatRequest) => Promise<ChatResponse>;
  structure: (req: StructureRequest) => Promise<StructureResponse>;
} {
  const promptsOf = memo((key) => {
    const [locale, id] = key.split("|") as [Locale, string];
    const plugin = deps.plugins.find((p) => p.id === id);
    if (!plugin) return undefined;
    const lang = promptLanguageOf(plugin);
    const rules = rulesOf(deps, locale);
    return {
      chat: buildChatPrompt(rules, lang, locale),
      structure: buildStructurePrompt(rules, lang, locale),
    };
  });
  return {
    chat: async (req) => {
      const locale = (await deps.locale?.()) ?? DEFAULT_LOCALE;
      const prompts = promptsOf(`${locale}|${req.language}`);
      if (!prompts) return noPrompt(req.language, locale);
      const { client, config } = await deps.llm();
      return chatNode(req, {
        llm: client,
        model: config.model,
        prompt: prompts.chat,
        locale,
      });
    },
    structure: async (req) => {
      const locale = (await deps.locale?.()) ?? DEFAULT_LOCALE;
      const prompts = promptsOf(`${locale}|${req.language}`);
      if (!prompts) return noPrompt(req.language, locale);
      const { client, config } = await deps.llm();
      return structureText(req, {
        llm: client,
        model: config.model,
        prompt: prompts.structure,
        locale,
      });
    },
  };
}

/** The store of what the person kept from the chat and removed, in `<cache>/notes`; one per language of the system. */
export function composeNotes(
  env: Record<string, string | undefined>,
  deps: ComposeDeps,
): (locale: Locale) => NotesStore {
  const dir = env.APP8N8_CACHE_DIR || deps.cacheDir;
  const storeOf = memo((locale) => createNotesStore(dir, locale as Locale));
  return (locale) => storeOf(locale);
}

/** Wires titleNodes with the same client, provider, models and cache folder rules as composeExplain; titles live in `<cache>/titles` (VID-14, VID-17). */
export function composeTitles(
  env: Record<string, string | undefined>,
  deps: ComposeDeps,
): (req: TitleRequest) => Promise<TitlesResponse> {
  const dir = env.APP8N8_CACHE_DIR || deps.cacheDir;
  const cacheOf = memo((locale) => createTitleCache(dir, locale as Locale));
  const promptsOf = memo((key) => {
    const [locale, id] = key.split("|") as [Locale, string];
    const plugin = deps.plugins.find((p) => p.id === id);
    if (!plugin) return undefined;
    const lang = promptLanguageOf(plugin);
    return {
      prompt: buildTitlePrompt(rulesOf(deps, locale), lang, locale),
      reviewer: buildTitleReviewerPrompt(lang, locale),
    };
  });
  return async (req) => {
    const locale = (await deps.locale?.()) ?? DEFAULT_LOCALE;
    const cache = cacheOf(locale);
    const { client, config } = await deps.llm();
    // A project may mix languages: each group goes with the prompts of its own language.
    const groups = new Map<string, TitleItem[]>();
    for (const item of req.items) {
      groups.set(item.language, [...(groups.get(item.language) ?? []), item]);
    }
    const answers = new Map<string, TitlesResponse>();
    for (const [language, items] of groups) {
      const prompts = promptsOf(`${locale}|${language}`);
      const titleDeps: TitleDeps | undefined = prompts && {
        ...prompts,
        locale,
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
          : { ...noPrompt(language, locale), titles: [] },
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
function noPrompt(
  language: string,
  locale: Locale,
): { status: "error"; message: string } {
  return {
    status: "error",
    message: translateSystem(locale, "error.noPrompt", { language }),
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

/** Port from APP8N8_PORT when it is a valid port number, else 8148. */
export function resolvePort(env: Record<string, string | undefined>): number {
  const raw = env.APP8N8_PORT ?? "";
  const port = Number(raw);
  return /^\d+$/.test(raw) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
}

export { languagePlugins };

/** Under this many files the builder thread costs more than it saves. */
const MIN_BUILDER_FILES = 150;

/**
 * The whole build (analyze, link, pack) in a worker thread, so the thread that serves the requests never
 * waits for it. In this thread when the host gives no worker, for a small project, and when the worker fails.
 */
export function composeBuild(
  worker: string | undefined,
  execArgv?: string[],
  cacheFile?: string,
): Build {
  if (worker === undefined) return buildInThread;
  const builder = createProjectBuilder({
    worker,
    ...(execArgv === undefined ? {} : { execArgv }),
    ...(cacheFile === undefined ? {} : { cacheFile }),
  });
  return async (input, plugins) => {
    if (input.files.length < MIN_BUILDER_FILES) {
      return buildInThread(input, plugins);
    }
    try {
      return await builder.build(input);
    } catch (error) {
      // A build that ran and found an error would find it again here, after blocking this thread.
      if (!(error instanceof BuilderLost)) throw error;
      console.error(
        "construção: o worker falhou, seguindo em sequência",
        error,
      );
      return buildInThread(input, plugins);
    }
  };
}

/** Reads the files of the plugins' extensions and maps them; what the server keeps is a `ProjectStore`, never the whole graph (PROJ-01, PROJ-05, PROJ-06, PROJ-07). */
export function composeReadProject(
  read: (path: string, filter: ReadFilter) => Promise<FolderRead>,
  plugins: LanguagePlugin[],
  ignoreDependencies: () => Promise<boolean> = async () => true,
  build: Build = buildInThread,
): (
  path: string,
  include?: string[],
  version?: string,
) => Promise<ProjectRead> {
  const filter: ReadFilter = {
    extensions: plugins.flatMap((p) => p.extensions),
    names: plugins.flatMap((p) => p.manifests ?? []),
    ignoredDirs: plugins.flatMap((p) => p.ignoredDirs),
  };
  // Reading is cheap and analyzing is not: a folder whose files did not change is not analyzed again.
  // The summary, suggestion and chat requests read the folder on every call, so they hit this too.
  const cache = createProjectCache<ProjectRead>();
  return async (path, include = [], version) => {
    // A screen that holds a build asks for its pieces by `version`: the last build is served without reading the folder again.
    const held = version === undefined ? undefined : cache.find(version);
    if (held) return held;
    const ignoring = await ignoreDependencies();
    const folder = await read(path, {
      ...filter,
      include,
      ignoreDependencies: ignoring,
    });
    if (folder.kind === "not-found") return folder;
    const { name, root, files, ignored } = folder;
    const key = [root, [...include].sort().join(","), ignoring].join("|");
    const fingerprint = versionOf(key, await fingerprintOf(files, ignored));
    return cache.get(key, fingerprint, async () => {
      const parts = await build(
        { name, files, ignored, version: fingerprint },
        plugins,
      );
      return { kind: "ok", root, project: createProjectStore(parts) };
    });
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
  /** The Português Técnico Simplificado rules the prompts carry in Portuguese. */
  ptsRules: string;
  /** The Simplified Technical English rules the prompts carry in English. */
  steRules: string;
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
  /** The bundled analysis worker (analysis-worker.mjs); without it, the analysis runs in the thread of the request. */
  analysisWorker?: string;
}

/**
 * Where the analysis cache lives: `<cache>/analysis`, in the folder of the other caches. The host sets APP8N8_NO_ANALYSIS_CACHE=1
 * in the environment it passes (`options.env`) to turn it off.
 */
export function analysisCacheFile(
  options: Pick<CoreOptions, "env" | "cacheDir">,
): string | undefined {
  if (options.env.APP8N8_NO_ANALYSIS_CACHE === "1") return undefined;
  return join(
    options.env.APP8N8_CACHE_DIR || options.cacheDir,
    "analysis",
    "cache.db",
  );
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
    steRules: options.steRules,
    cacheDir: options.cacheDir,
    locale: () => settings.locale(),
  };
  return createApp({
    plugins: languagePlugins,
    explain: composeExplain(options.env, compose),
    titles: composeTitles(options.env, compose),
    ...composeChat(compose),
    notes: composeNotes(options.env, compose),
    readProject: composeReadProject(
      readSourceFolder,
      languagePlugins,
      () => settings.ignoreDependencies(),
      composeBuild(
        options.analysisWorker,
        undefined,
        analysisCacheFile(options),
      ),
    ),
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
