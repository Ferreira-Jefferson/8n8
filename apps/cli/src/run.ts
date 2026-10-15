import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createCore, resolvePort } from "@8n8/server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

/** Every effect of a run, injectable: tests record them instead of opening ports and browsers. */
export interface RunDeps {
  env: Record<string, string | undefined>;
  /** The terminal's folder: a relative folder resolves from here (DIST-03). */
  cwd: string;
  /** The user's home: data lives in <home>/.8n8 (DIST-09). */
  home: string;
  paths: {
    /** The built screen to serve; undefined when Vite serves it (pnpm dev). */
    web: string | undefined;
    /** The Português Técnico Simplificado rules file. */
    ptsRules: string;
  };
  out: (line: string) => void;
  err: (line: string) => void;
  /** Listens on loopback; rejects with the listen error (EADDRINUSE). */
  serve: (app: Hono, port: number) => Promise<void>;
  openBrowser: (url: string) => void;
}

const HELP = `Uso: 8n8 [pasta] [--no-open]

Abre no navegador o mapa da pasta (ou a tela inicial, sem pasta).

Opções:
  --no-open   sobe o servidor sem abrir o navegador
  --help      mostra este texto

Variáveis de ambiente:
  APP8N8_PORT          porta do servidor (padrão 4317)
  APP8N8_CACHE_DIR     pasta do cache (padrão ~/.8n8/cache)
  APP8N8_HISTORY_DIR   pasta do historico.db (padrão ~/.8n8)
  APP8N8_TOKEN         token de sessão fixo, com 32 caracteres ou mais (testes)

LLM (opcional; sem chave, o mapa funciona):
  APP8N8_LLM_PROVIDER  openrouter (padrão) ou openai-compatible
  OPENROUTER_API_KEY, OPENROUTER_BASE_URL
  APP8N8_LLM_API_KEY, APP8N8_LLM_BASE_URL
  APP8N8_MODEL, APP8N8_REVIEW_MODEL`;

const isFolder = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** `8n8 [pasta] [--no-open] [--help]`; the result is the exit code. */
export async function run(argv: string[], deps: RunDeps): Promise<number> {
  let args: ReturnType<typeof parse>;
  try {
    args = parse(argv);
  } catch (e) {
    deps.err(e instanceof Error ? e.message : String(e));
    deps.err("Veja 8n8 --help.");
    return 1;
  }
  if (args.values.help) {
    deps.out(HELP);
    return 0;
  }

  const given = args.positionals[0];
  const folder = given === undefined ? undefined : resolve(deps.cwd, given);
  if (given !== undefined && (folder === undefined || !isFolder(folder))) {
    deps.err(`Pasta não encontrada: ${given}`);
    return 1;
  }

  const fixed = deps.env.APP8N8_TOKEN ?? "";
  if (fixed !== "" && fixed.length < 32) {
    deps.err("APP8N8_TOKEN precisa de 32 caracteres ou mais.");
    return 1;
  }
  const token = fixed || randomBytes(32).toString("hex");

  const port = resolvePort(deps.env);
  const data = join(deps.home, ".8n8");
  const app = createCore({
    env: deps.env,
    ptsRules: readFileSync(deps.paths.ptsRules, "utf8"),
    cacheDir: join(data, "cache"),
    historyFile: join(deps.env.APP8N8_HISTORY_DIR || data, "historico.db"),
    port,
    token,
  });
  if (deps.paths.web !== undefined) {
    app.use("/*", serveStatic({ root: deps.paths.web }));
  }

  try {
    await deps.serve(app, port);
  } catch (e) {
    const error = e as NodeJS.ErrnoException;
    deps.err(
      error.code === "EADDRINUSE"
        ? `A porta ${port} já está em uso. Feche o outro processo e tente de novo.`
        : `Erro ao subir o servidor: ${error.message}`,
    );
    return 1;
  }

  // The fragment never reaches the server: the token stays out of logs (DIST-18).
  const launch = new URLSearchParams({
    t: token,
    ...(folder === undefined ? {} : { pasta: folder }),
  });
  const url = `http://127.0.0.1:${port}/#${launch}`;
  deps.out(`8n8 em ${url}`);
  if (!args.values["no-open"]) deps.openBrowser(url);
  return 0;
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean" },
      "no-open": { type: "boolean" },
    },
  });
}
