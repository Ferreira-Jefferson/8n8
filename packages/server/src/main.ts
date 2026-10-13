import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildSystemPrompt,
  createDiskCache,
  createOpenRouterClient,
  explainNode,
  type LlmClient,
  resolveModel,
} from "@code2n8n/explain";
import { createPythonExtractor } from "@code2n8n/extract-python";
import type { ExplainRequest, ExplainResponse } from "@code2n8n/model";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app";

const PORT = 4317;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface ComposeDeps {
  createClient: (apiKey: string) => LlmClient;
  ptsRules: string;
  cacheDir: string;
}

/** Wires explainNode: the client exists only when OPENROUTER_API_KEY is set (CORE-19, CORE-21). */
export function composeExplain(
  env: Record<string, string | undefined>,
  deps: ComposeDeps,
): (req: ExplainRequest) => Promise<ExplainResponse> {
  const apiKey = env.OPENROUTER_API_KEY;
  const explainDeps = {
    llm: apiKey ? deps.createClient(apiKey) : undefined,
    cache: createDiskCache(deps.cacheDir),
    model: resolveModel(env),
    prompt: buildSystemPrompt(deps.ptsRules),
  };
  return (req) => explainNode(req, explainDeps);
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(join(repoRoot, ".env"));
  } catch {
    // no .env: the explain panel answers no-key
  }
  const ptsRules = readFileSync(
    join(repoRoot, "docs/portugues-tecnico-simplificado.md"),
    "utf8",
  );
  const app = createApp({
    extractor: await createPythonExtractor(),
    explain: composeExplain(process.env, {
      createClient: (key) => createOpenRouterClient(key),
      ptsRules,
      cacheDir: join(repoRoot, ".cache/explain"),
    }),
    port: PORT,
  });
  if (process.argv[2] === "start") {
    const dist = join(repoRoot, "apps/web/dist");
    app.use("/*", serveStatic({ root: relative(process.cwd(), dist) }));
  }
  const server = serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" });
  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(
      err.code === "EADDRINUSE"
        ? `A porta ${PORT} já está em uso. Feche o outro processo e tente de novo.`
        : `Erro ao subir o servidor: ${err.message}`,
    );
    process.exit(1);
  });
  console.log(`code2n8n em http://127.0.0.1:${PORT}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
