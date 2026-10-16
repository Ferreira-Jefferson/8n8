import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  createCore,
  createFileSettingsStore,
  DEFAULT_LOCALE,
  resolvePort,
  translateSystem,
} from "@8n8/server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

/** Every effect of a run, injectable: tests record them instead of opening ports and browsers. */
export interface RunDeps {
  env: Record<string, string | undefined>;
  /** The terminal's folder: a relative folder resolves from here (DIST-03). */
  cwd: string;
  /** The user's home: data and settings live in <home>/.8n8 (DIST-09, CFG-19). */
  home: string;
  paths: {
    /** The built screen to serve; undefined when Vite serves it (pnpm dev). */
    web: string | undefined;
    /** The Português Técnico Simplificado rules file. */
    ptsRules: string;
    /** The Simplified Technical English rules file. */
    steRules: string;
  };
  out: (line: string) => void;
  err: (line: string) => void;
  /** Listens on loopback; rejects with the listen error (EADDRINUSE). */
  serve: (app: Hono, port: number) => Promise<void>;
  /** `app` asks for a window with no address bar; the host falls back to a tab. */
  openBrowser: (url: string, app: boolean) => void;
}

const isFolder = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** `8n8 [pasta] [--no-open] [--no-app] [--help]`; the result is the exit code. */
export async function run(argv: string[], deps: RunDeps): Promise<number> {
  const data = join(deps.home, ".8n8");
  const settings = createFileSettingsStore(
    join(deps.env.APP8N8_CONFIG_DIR || data, "config.json"),
  );
  // The terminal speaks the language chosen on the screen; a missing file reads as the default.
  const locale = (await settings.read()).locale ?? DEFAULT_LOCALE;
  const t = (
    key: Parameters<typeof translateSystem>[1],
    vars?: Record<string, string | number>,
  ) => translateSystem(locale, key, vars);
  let args: ReturnType<typeof parse>;
  try {
    args = parse(argv);
  } catch (e) {
    deps.err(e instanceof Error ? e.message : String(e));
    deps.err(t("cli.seeHelp"));
    return 1;
  }
  if (args.values.help) {
    deps.out(t("cli.help"));
    return 0;
  }

  const given = args.positionals[0];
  const folder = given === undefined ? undefined : resolve(deps.cwd, given);
  if (given !== undefined && (folder === undefined || !isFolder(folder))) {
    deps.err(t("cli.folderNotFound", { path: given }));
    return 1;
  }

  const fixed = deps.env.APP8N8_TOKEN ?? "";
  if (fixed !== "" && fixed.length < 32) {
    deps.err(t("cli.tokenShort"));
    return 1;
  }
  const token = fixed || randomBytes(32).toString("hex");

  const port = resolvePort(deps.env);
  const app = createCore({
    env: deps.env,
    ptsRules: readFileSync(deps.paths.ptsRules, "utf8"),
    steRules: readFileSync(deps.paths.steRules, "utf8"),
    cacheDir: join(data, "cache"),
    historyFile: join(deps.env.APP8N8_HISTORY_DIR || data, "historico.db"),
    port,
    token,
    settings,
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
        ? t("cli.portInUse", { port })
        : t("cli.serverError", { message: error.message }),
    );
    return 1;
  }

  // The fragment never reaches the server: the token stays out of logs (DIST-18).
  const launch = new URLSearchParams({
    t: token,
    ...(folder === undefined ? {} : { pasta: folder }),
  });
  const url = `http://8n8.localhost:${port}/#${launch}`;
  deps.out(t("cli.running", { url }));
  if (!args.values["no-open"]) deps.openBrowser(url, !args.values["no-app"]);
  return 0;
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean" },
      "no-open": { type: "boolean" },
      "no-app": { type: "boolean" },
    },
  });
}
