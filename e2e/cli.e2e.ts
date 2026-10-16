import {
  type ChildProcess,
  type SpawnSyncReturns,
  spawn,
  spawnSync,
} from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { breadcrumb, clickCard, expectLevel } from "./mapa";

// Feature 07-cli, end to end: the package `pnpm pack` makes (pnpm e2e builds the CLI
// first), installed with `npm install -g --offline` into a temp prefix and run as the
// `8n8` command, with its home in a temp folder and the fake LLM of 4318.

const REPO = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = join(
  REPO,
  "packages/languages/python/src/__tests__/fixtures/projeto-loja",
);
const PORT = "4330";
// A function the fake LLM summarizes and its reviewer accepts (fake-llm.ts), so the
// explanation is cached. A project node id carries its file (AD-013).
const CONTAGEM =
  "def total_sem_doc(itens):\n    n = len(itens)\n    print(n)\n    return n\n";
const COUNT_FN = "file:contagem.py/fn:total_sem_doc";
const WINDOWS = process.platform === "win32";

// No extra header: the page must call the API with the token of the fragment alone.
test.use({ extraHTTPHeaders: {} });
test.describe.configure({ timeout: 180_000 });

let tmp = "";
let prefix = "";
let home = "";
let loja = "";
let command = "";
let server: ChildProcess | undefined;
let url = "";
const before = { loja: [] as string[], prefix: [] as string[] };
/** Everything the installed CLI printed, stdout and stderr, in every run (DIST-22). */
let terminal = "";

/** path + sha256 of every file under `dir`: equal lists mean nothing was written. */
function stamps(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else
        out.push(
          `${relative(dir, full)} ${createHash("sha256").update(readFileSync(full)).digest("hex")}`,
        );
    }
  };
  walk(dir);
  return out.sort();
}

/** The env of the installed CLI: a temp home, the fake LLM, no data folder overrides. */
function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APP8N8_PORT: PORT,
    OPENROUTER_API_KEY: "e2e-fake-key",
    OPENROUTER_BASE_URL: "http://127.0.0.1:4318/v1",
    APP8N8_MODEL: "e2e/drafter",
    APP8N8_REVIEW_MODEL: "e2e/reviewer",
  };
  for (const key of [
    "APP8N8_CACHE_DIR",
    "APP8N8_HISTORY_DIR",
    "APP8N8_TOKEN",
  ]) {
    delete env[key];
  }
  return env;
}

// On Windows npm installs a .cmd shim, which only runs through a shell; the
// arguments are temp paths with no spaces, quoted anyway.
const quoted = (args: string[]) => (WINDOWS ? args.map((a) => `"${a}"`) : args);

// Runs from the temp folder, never from the repository: the package must not lean on
// any repository file (DIST-12).
function run8n8(args: string[]): SpawnSyncReturns<string> {
  const r = spawnSync(command, quoted(args), {
    cwd: tmp,
    env: cliEnv(),
    encoding: "utf8",
    shell: WINDOWS,
    timeout: 60_000,
  });
  terminal += r.stdout + r.stderr;
  return r;
}

function sh(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, {
    cwd: REPO,
    encoding: "utf8",
    shell: WINDOWS,
    timeout: 120_000,
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

/** Starts `8n8 <args>` and resolves with the address it prints. */
function start8n8(
  args: string[],
): Promise<{ child: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, quoted(args), {
      cwd: tmp,
      env: cliEnv(),
      shell: WINDOWS,
    });
    let printed = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      terminal += chunk.toString();
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      printed += chunk.toString();
      terminal += chunk.toString();
      const match = /8n8 em (\S+)/.exec(printed);
      if (match?.[1]) resolve({ child, url: match[1] });
    });
    child.on("exit", (code) => reject(new Error(`8n8 saiu com ${code}`)));
  });
}

function stop(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  // The .cmd shim starts node as a child: only a tree kill stops the server.
  if (WINDOWS) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else child.kill();
}

test.beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "8n8-cli-"));
  sh("pnpm", ["--filter", "@8n8/cli", "pack", "--pack-destination", tmp]);
  const tgz = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error("pnpm pack gerou nenhum .tgz");
  prefix = join(tmp, "prefix");
  sh("npm", [
    "install",
    "-g",
    "--prefix",
    prefix,
    "--offline",
    "--no-audit",
    "--no-fund",
    join(tmp, tgz),
  ]);
  command = WINDOWS ? join(prefix, "8n8.cmd") : join(prefix, "bin", "8n8");
  home = join(tmp, "home");
  mkdirSync(home);
  loja = join(tmp, "loja");
  cpSync(FIXTURE, loja, { recursive: true });
  writeFileSync(join(loja, "contagem.py"), CONTAGEM);
  before.loja = stamps(loja);
  before.prefix = stamps(prefix);
  ({ child: server, url } = await start8n8([loja, "--no-open"]));
});

test.afterAll(() => {
  stop(server);
  if (tmp) {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      // Windows may keep the history file locked for a moment after the tree kill.
    }
  }
});

test("DIST-12, DIST-01: the installed 8n8 prints an address that opens the folder's map, with the fragment's token alone", async ({
  page,
}) => {
  expect(url).toMatch(/^http:\/\/8n8\.localhost:4330\/#t=[0-9a-f]{64}&pasta=/);
  await page.goto(url);
  await expectLevel(page, [
    "dir:frete",
    "dir:legado",
    "dir:pedidos",
    "file:contagem.py",
    "file:main.py",
    "file:relatorio.py",
  ]);
  await expect(breadcrumb(page).getByRole("button")).toHaveText(["loja"]);
  // The token left the address bar (DIST-19).
  expect(new URL(page.url()).hash).toBe("");
});

test("DIST-09: data lives in <home>/.8n8: an explained node lands in the cache, the map in the history", async ({
  page,
}) => {
  await page.goto(url);
  await clickCard(page, "file:contagem.py");
  await clickCard(page, COUNT_FN);
  // The installed CLI asks for nothing on its own: the summary waits for the click (CFG-06).
  await page.getByRole("button", { name: "Gerar resumo" }).click();
  const nodesDir = join(home, ".8n8", "cache", "nodes");
  await expect
    .poll(
      () =>
        existsSync(nodesDir) &&
        readdirSync(nodesDir).some((f) => f.endsWith(".json")),
      { timeout: 30_000 },
    )
    .toBe(true);
  expect(existsSync(join(home, ".8n8", "historico.db"))).toBe(true);
});

test("DIST-08: --help prints the usage, exits 0 and no ExperimentalWarning reaches stderr", () => {
  const r = run8n8(["--help"]);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("8n8 [pasta]");
  expect(r.stderr).not.toContain("ExperimentalWarning");
});

test("DIST-05: a missing folder prints Pasta não encontrada and exits 1", () => {
  const missing = join(tmp, "nada");
  const r = run8n8([missing, "--no-open"]);
  expect(r.status).toBe(1);
  expect(r.stderr.trim()).toBe(`Pasta não encontrada: ${missing}`);
});

test("DIST-06: a second 8n8 on the same port prints the port message and exits 1", () => {
  const r = run8n8([loja, "--no-open"]);
  expect(r.status).toBe(1);
  expect(r.stderr.trim()).toBe(
    `A porta ${PORT} já está em uso. Feche o outro processo e tente de novo.`,
  );
});

test("DIST-22: no run of the installed CLI prints the API key, whole or by its start", () => {
  // The server run, --help, the missing folder and the busy port all printed something.
  expect(terminal).toContain("8n8 em http://8n8.localhost:4330/");
  expect(terminal).toContain("Pasta não encontrada:");
  expect(terminal).not.toContain("e2e-fake-key");
  expect(terminal).not.toContain("e2e-fa");
});

test("DIST-10: the analysed folder and the install folder stay byte for byte the same", () => {
  stop(server);
  server = undefined;
  expect(stamps(loja)).toEqual(before.loja);
  expect(stamps(prefix)).toEqual(before.prefix);
});
