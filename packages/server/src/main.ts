import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createCore, listenOptions, resolvePort } from "./core";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

async function main(): Promise<void> {
  try {
    process.loadEnvFile(join(repoRoot, ".env"));
  } catch {
    // no .env: the explain panel answers no-key
  }
  const port = resolvePort(process.env);
  const cacheDir = join(repoRoot, ".cache/explain");
  const app = createCore({
    env: process.env,
    ptsRules: readFileSync(
      join(repoRoot, "docs/portugues-tecnico-simplificado.md"),
      "utf8",
    ),
    cacheDir,
    // The history is user data, not explain cache: it has its own folder, so wiping
    // the cache never meets the open database file (Windows refuses that delete).
    historyFile: join(
      process.env.APP8N8_HISTORY_DIR || cacheDir,
      "historico.db",
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
