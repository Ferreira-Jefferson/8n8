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
  createOpenRouterClient,
  createTitleCache,
  explainNode,
  type LlmClient,
  resolveModel,
  resolveReviewModel,
  titleNodes,
} from "@code2n8n/explain";
import { createPythonExtractor } from "@code2n8n/extract-python";
import { type FolderRead, readSourceFolder } from "@code2n8n/input";
import type {
  ExplainRequest,
  ExplainResponse,
  ProjectExtractor,
  TitleRequest,
  TitlesResponse,
} from "@code2n8n/model";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp, type ProjectRead } from "./app";
import { type History, openHistory } from "./history";

const DEFAULT_PORT = 4317;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface ComposeDeps {
  /** `baseURL` is undefined when OPENROUTER_BASE_URL is unset or empty. */
  createClient: (apiKey: string, baseURL: string | undefined) => LlmClient;
  ptsRules: string;
  cacheDir: string;
}

/** Wires explainNode: the client exists only when OPENROUTER_API_KEY is set (CORE-19, CORE-21, FID-15); empty env values count as absent. */
export function composeExplain(
  env: Record<string, string | undefined>,
  deps: ComposeDeps,
): (req: ExplainRequest) => Promise<ExplainResponse> {
  const apiKey = env.OPENROUTER_API_KEY;
  const explainDeps = {
    llm: apiKey
      ? deps.createClient(apiKey, env.OPENROUTER_BASE_URL || undefined)
      : undefined,
    cache: createDiskCache(env.CODE2N8N_CACHE_DIR || deps.cacheDir),
    model: resolveModel(env),
    reviewModel: resolveReviewModel(env),
    prompt: buildSystemPrompt(deps.ptsRules),
    stepPrompt: buildStepPrompt(deps.ptsRules),
    reviewer: buildReviewerPrompt(),
  };
  return (req) => explainNode(req, explainDeps);
}

/** Wires titleNodes with the same key, base URL, model and cache folder rules as composeExplain; titles live in `<cache>/titles` (VID-14, VID-17). */
export function composeTitles(
  env: Record<string, string | undefined>,
  deps: ComposeDeps,
): (req: TitleRequest) => Promise<TitlesResponse> {
  const apiKey = env.OPENROUTER_API_KEY;
  const titleDeps = {
    llm: apiKey
      ? deps.createClient(apiKey, env.OPENROUTER_BASE_URL || undefined)
      : undefined,
    cache: createTitleCache(env.CODE2N8N_CACHE_DIR || deps.cacheDir),
    model: resolveModel(env),
    reviewModel: resolveReviewModel(env),
    prompt: buildTitlePrompt(deps.ptsRules),
    reviewer: buildTitleReviewerPrompt(),
  };
  return (req) => titleNodes(req, titleDeps);
}

/** Port from CODE2N8N_PORT when it is a valid port number, else 4317. */
export function resolvePort(env: Record<string, string | undefined>): number {
  const raw = env.CODE2N8N_PORT ?? "";
  const port = Number(raw);
  return /^\d+$/.test(raw) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
}

/** Reads the folder and maps it: the extractor sets `graph.project` (PROJ-01, PROJ-05, PROJ-06, PROJ-07). */
export function composeReadProject(
  read: (path: string, extension: string) => Promise<FolderRead>,
  extractor: ProjectExtractor,
): (path: string) => Promise<ProjectRead> {
  return async (path) => {
    const folder = await read(path, ".py");
    if (folder.kind === "not-found") return folder;
    const { name, root, files, ignored } = folder;
    const graph = { ...extractor.extractProject(files), project: { name } };
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
  const extractor = await createPythonExtractor();
  const compose = {
    createClient: (key: string, baseURL: string | undefined) =>
      createOpenRouterClient(key, { baseURL }),
    ptsRules,
    cacheDir: join(repoRoot, ".cache/explain"),
  };
  const app = createApp({
    extractor,
    explain: composeExplain(process.env, compose),
    titles: composeTitles(process.env, compose),
    readProject: composeReadProject(readSourceFolder, extractor),
    history: openHistoryOrWarn(
      join(process.env.CODE2N8N_CACHE_DIR || compose.cacheDir, "historico.db"),
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
  console.log(`code2n8n em http://127.0.0.1:${port}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
