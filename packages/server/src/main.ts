import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildReviewerPrompt,
  buildStepPrompt,
  buildSystemPrompt,
  buildTitlePrompt,
  buildTitleReviewerPrompt,
  createDiskCache,
  createTitleCache,
  type ExplainDeps,
  explainNode,
  type PromptLanguage,
  type TitleDeps,
  titleNodes,
} from "@code2n8n/explain";
import {
  type FolderRead,
  type ReadFilter,
  readSourceFolder,
} from "@code2n8n/input";
import { pythonPlugin } from "@code2n8n/lang-python";
import { typescriptPlugin } from "@code2n8n/lang-typescript";
import { linkProject } from "@code2n8n/links";
import {
  createLlmClient,
  type LlmConfig,
  resolveLlmConfig,
} from "@code2n8n/llm";
import type {
  ExplainRequest,
  ExplainResponse,
  LanguagePlugin,
  LlmClient,
  TitleItem,
  TitleRequest,
  TitlesResponse,
} from "@code2n8n/model";
import { analyzeProject } from "@code2n8n/project";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp, type ProjectRead } from "./app";
import { type History, openHistory } from "./history";

const DEFAULT_PORT = 4317;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** The one LLM client of the server and the config it came from; the client is absent when the provider lacks its key or URL (CORE-19). */
export interface LlmSetup {
  client: LlmClient | undefined;
  config: LlmConfig;
}

export interface ComposeDeps {
  llm: LlmSetup;
  /** The languages the server reads: each one gets its own prompts. */
  plugins: LanguagePlugin[];
  ptsRules: string;
  cacheDir: string;
}

/** Resolves the config and builds the client once; `createClient` is injectable for tests. */
export function composeLlm(
  env: Record<string, string | undefined>,
  createClient: (config: LlmConfig) => LlmClient | undefined = createLlmClient,
): LlmSetup {
  const config = resolveLlmConfig(env);
  return { client: createClient(config), config };
}

/** Wires explainNode with the shared client, provider and models (CORE-19, CORE-21, FID-15). */
export function composeExplain(
  env: Record<string, string | undefined>,
  deps: ComposeDeps,
): (req: ExplainRequest) => Promise<ExplainResponse> {
  const { client, config } = deps.llm;
  const cache = createDiskCache(env.CODE2N8N_CACHE_DIR || deps.cacheDir);
  // One set of prompts per language: a request picks its set by `language` (6.1-6.3).
  const byLanguage = new Map<string, ExplainDeps>(
    deps.plugins.map((plugin) => {
      const lang = promptLanguageOf(plugin);
      return [
        plugin.id,
        {
          llm: client,
          cache,
          provider: config.provider,
          model: config.model,
          reviewModel: config.reviewModel,
          prompt: buildSystemPrompt(deps.ptsRules, lang),
          stepPrompt: buildStepPrompt(deps.ptsRules, lang),
          reviewer: buildReviewerPrompt(lang),
        },
      ];
    }),
  );
  return async (req) => {
    const explainDeps = byLanguage.get(req.language);
    if (!explainDeps) return noPrompt(req.language);
    return explainNode(req, explainDeps);
  };
}

/** Wires titleNodes with the same client, provider, models and cache folder rules as composeExplain; titles live in `<cache>/titles` (VID-14, VID-17). */
export function composeTitles(
  env: Record<string, string | undefined>,
  deps: ComposeDeps,
): (req: TitleRequest) => Promise<TitlesResponse> {
  const { client, config } = deps.llm;
  const cache = createTitleCache(env.CODE2N8N_CACHE_DIR || deps.cacheDir);
  const byLanguage = new Map<string, TitleDeps>(
    deps.plugins.map((plugin) => {
      const lang = promptLanguageOf(plugin);
      return [
        plugin.id,
        {
          llm: client,
          cache,
          provider: config.provider,
          model: config.model,
          reviewModel: config.reviewModel,
          prompt: buildTitlePrompt(deps.ptsRules, lang),
          reviewer: buildTitleReviewerPrompt(lang),
        },
      ];
    }),
  );
  return async (req) => {
    // A project may mix languages: each group goes with the prompts of its own language.
    const groups = new Map<string, TitleItem[]>();
    for (const item of req.items) {
      groups.set(item.language, [...(groups.get(item.language) ?? []), item]);
    }
    const answers = new Map<string, TitlesResponse>();
    for (const [language, items] of groups) {
      const titleDeps = byLanguage.get(language);
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

/** Port from CODE2N8N_PORT when it is a valid port number, else 4317. */
export function resolvePort(env: Record<string, string | undefined>): number {
  const raw = env.CODE2N8N_PORT ?? "";
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
): (path: string) => Promise<ProjectRead> {
  const filter: ReadFilter = {
    extensions: plugins.flatMap((p) => p.extensions),
    ignoredDirs: plugins.flatMap((p) => p.ignoredDirs),
  };
  return async (path) => {
    const folder = await read(path, filter);
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

async function main(): Promise<void> {
  try {
    process.loadEnvFile(join(repoRoot, ".env"));
  } catch {
    // no .env: the explain panel answers no-key
  }
  const port = resolvePort(process.env);
  const ptsRules = readFileSync(
    join(repoRoot, "docs/portugues-tecnico-simplificado.md"),
    "utf8",
  );
  const compose = {
    llm: composeLlm(process.env),
    plugins: languagePlugins,
    ptsRules,
    cacheDir: join(repoRoot, ".cache/explain"),
  };
  const app = createApp({
    plugins: languagePlugins,
    explain: composeExplain(process.env, compose),
    titles: composeTitles(process.env, compose),
    readProject: composeReadProject(readSourceFolder, languagePlugins),
    // The history is user data, not explain cache: it has its own folder, so wiping
    // the cache never meets the open database file (Windows refuses that delete).
    history: openHistoryOrWarn(
      join(
        process.env.CODE2N8N_HISTORY_DIR || compose.cacheDir,
        "historico.db",
      ),
    ),
    port,
  });
  if (process.argv[2] === "start") {
    const dist = join(repoRoot, "apps/web/dist");
    app.use("/*", serveStatic({ root: relative(process.cwd(), dist) }));
  }
  const server = serve({ fetch: app.fetch, ...listenOptions(port) });
  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(
      err.code === "EADDRINUSE"
        ? `A porta ${port} já está em uso. Feche o outro processo e tente de novo.`
        : `Erro ao subir o servidor: ${err.message}`,
    );
    process.exit(1);
  });
  console.log(`8n8 em http://127.0.0.1:${port}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
