import { createServer } from "node:net";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import {
  INSPECT_OFFSET,
  LANE_PORT,
  laneDir,
  lanePort,
  portsTaken,
  RUN,
  runPort,
} from "./e2e/lane";

// Each worker gets a lane of servers of its own (e2e/lane.ts), so the count is set here:
// E2E_WORKERS changes it; --workers does not. Two at most by default: on a laptop with two
// fast cores, three or six workers ran the whole suite slower than two.
const WORKERS = Number(
  process.env.E2E_WORKERS ??
    Math.max(1, Math.min(2, Math.floor(availableParallelism() / 2))),
);
const LANES = Array.from({ length: WORKERS }, (_, lane) => lane);

const isFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });

/** A block of free ports in 20000-59999, far from the app (8148): one per run. */
async function drawPortBase(): Promise<number> {
  const size = portsTaken(WORKERS);
  for (let tries = 0; tries < 20; tries++) {
    const base = 20_000 + 100 * Math.floor(Math.random() * 400);
    const ports = Array.from({ length: size }, (_, i) => base + i);
    if ((await Promise.all(ports.map(isFree))).every(Boolean)) return base;
  }
  throw new Error("e2e: nenhuma faixa de portas livre entre 20000 e 59999");
}

// The runner draws the block; its workers inherit the variable and keep it.
process.env.E2E_PORT_BASE ??= String(await drawPortBase());
const CLI_PORT = runPort(RUN.cli);
const laneURL = (offset: number, lane: number) =>
  `http://127.0.0.1:${lanePort(offset, lane)}`;
// Each worker goes to its lane's keyless server instead (e2e/test.ts).
const URL = laneURL(LANE_PORT.offline, 0);
/** The built CLI on `port`; with E2E_COVERAGE=1 its inspector opens too (e2e/test.ts). */
const cli = (port: number) =>
  process.env.E2E_COVERAGE
    ? `node --inspect=127.0.0.1:${port + INSPECT_OFFSET} apps/cli/dist/8n8.mjs --no-open`
    : "node apps/cli/dist/8n8.mjs --no-open";
// Every test server runs with this session token, and every page request carries it (DIST-20).
// Obviously fake and low entropy, so gitleaks does not take it for a secret.
export const E2E_TOKEN = "e2e-session-token-not-a-secret-0000";
const repoRoot = dirname(fileURLToPath(import.meta.url));
const cacheDir = (name: string) => join(repoRoot, ".cache", name);
// The specs written before feature 08 test the pipeline, not the way to ask: their
// servers explain a node as soon as it is selected. configuracoes.e2e.ts covers the clicks.
const AUTO = { APP8N8_AUTO_SUMMARY: "1", APP8N8_AUTO_SUGGESTIONS: "1" };
// A variable that names no file turns the Claude Code lookup off (CC-15, CC-16): no test
// server reaches the claude of the machine running the tests, and none defaults to it.
export const NO_CLAUDE = {
  APP8N8_CLAUDE_PATH: join(cacheDir("e2e-no-claude"), "claude.exe"),
};

const fakeURL = (lane: number) => laneURL(LANE_PORT.fake, lane);

// The panel starts minimized (8n8.panelOpen); the specs written before that open it.
const PANEL_OPEN = {
  cookies: [],
  origins: [
    `http://127.0.0.1:${CLI_PORT}`,
    ...LANES.flatMap((lane) =>
      Object.values(LANE_PORT)
        .filter((offset) => offset !== LANE_PORT.fake)
        .map((offset) => laneURL(offset, lane)),
    ),
    // The installed CLI prints 8n8.localhost, another origin for the same port.
    ...LANES.map(
      (lane) => `http://8n8.localhost:${lanePort(LANE_PORT.offline, lane)}`,
    ),
    `http://8n8.localhost:${CLI_PORT}`,
  ].map((origin) => ({
    origin,
    localStorage: [{ name: "8n8.panelOpen", value: "1" }],
  })),
};

export default defineConfig({
  testDir: "e2e",
  // *.e2e.ts, never *.test.ts or *.spec.ts: Vitest does not pick these up.
  testMatch: "**/*.e2e.ts",
  // Files run in parallel; the tests of one file keep their order.
  fullyParallel: false,
  workers: WORKERS,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  // Screenshot baselines are committed under e2e/__baselines__/<platform>/ (D3).
  snapshotPathTemplate: "{testDir}/__baselines__/{platform}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.002,
    },
  },
  use: {
    baseURL: URL,
    // The specs check the dark theme; marca.e2e.ts asks for the light one.
    colorScheme: "dark",
    extraHTTPHeaders: { "x-8n8-token": E2E_TOKEN },
    storageState: PANEL_OPEN,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: ["**/performance.e2e.ts"],
    },
    // Measurements, not checks: kept out of `pnpm e2e`. Run them with
    // APP8N8_PERF=1 pnpm exec playwright test --project performance
    ...(process.env.APP8N8_PERF
      ? [
          {
            name: "performance",
            use: { ...devices["Desktop Chrome"] },
            testMatch: "**/performance.e2e.ts",
          },
        ]
      : []),
  ],
  // Never reuse a running server: it may hold the real key from .env.
  // The built CLI never reads .env; every variable below is set explicitly.
  webServer: [
    // The servers of a lane (e2e/lane.ts) take its ports and its cache dirs.
    ...LANES.map((lane) => ({
      // OpenAI-compatible fake LLM (e2e/fake-llm.ts); the keyed servers talk only to it.
      command: "tsx e2e/fake-llm.ts",
      url: `${fakeURL(lane)}/__log`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { E2E_FAKE_PORT: String(lanePort(LANE_PORT.fake, lane)) },
    })),
    ...LANES.flatMap((lane) => [
      {
        // The built CLI (pnpm e2e builds it first) with the real API and no key (feature 01).
        command: cli(lanePort(LANE_PORT.offline, lane)),
        url: laneURL(LANE_PORT.offline, lane),
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          APP8N8_TOKEN: E2E_TOKEN,
          APP8N8_PORT: String(lanePort(LANE_PORT.offline, lane)),
          ...NO_CLAUDE,
          // Set and empty: .env never supplies the key.
          OPENROUTER_API_KEY: "",
          // A cache dir of its own (<repo>/.cache/e2e-offline), apart from the user's entries;
          // with no key the server never writes.
          APP8N8_CACHE_DIR: cacheDir(laneDir("e2e-offline", lane)),
          APP8N8_CONFIG_DIR: cacheDir(laneDir("e2e-offline-config", lane)),
          ...AUTO,
          // The history lives apart: the specs wipe the cache dir, never this one.
          APP8N8_HISTORY_DIR: cacheDir(laneDir("e2e-offline-history", lane)),
          APP8N8_MODEL: "e2e/offline",
        },
      },
      {
        // A keyless server of its own for historico.e2e.ts: that spec wipes and counts the
        // history, so the maps other specs open on the keyless server stay out of it.
        command: cli(lanePort(LANE_PORT.history, lane)),
        url: laneURL(LANE_PORT.history, lane),
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          APP8N8_TOKEN: E2E_TOKEN,
          ...NO_CLAUDE,
          APP8N8_PORT: String(lanePort(LANE_PORT.history, lane)),
          OPENROUTER_API_KEY: "",
          APP8N8_CACHE_DIR: cacheDir(laneDir("e2e-history-offline", lane)),
          APP8N8_CONFIG_DIR: cacheDir(
            laneDir("e2e-history-offline-config", lane),
          ),
          ...AUTO,
          APP8N8_HISTORY_DIR: cacheDir(laneDir("e2e-history", lane)),
          APP8N8_MODEL: "e2e/offline",
        },
      },
      {
        // The real review pipeline against the fake LLM, with the screen of the built CLI.
        command: cli(lanePort(LANE_PORT.real, lane)),
        url: `http://127.0.0.1:${lanePort(LANE_PORT.real, lane)}`,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          APP8N8_TOKEN: E2E_TOKEN,
          ...NO_CLAUDE,
          APP8N8_PORT: String(lanePort(LANE_PORT.real, lane)),
          // A fake key and a local base URL: no request ever reaches openrouter.ai.
          OPENROUTER_API_KEY: "e2e-fake-key",
          OPENROUTER_BASE_URL: `${fakeURL(lane)}/v1`,
          APP8N8_MODEL: "e2e/drafter",
          APP8N8_REVIEW_MODEL: "e2e/reviewer",
          // Isolated cache, wiped by the specs before each test.
          APP8N8_CACHE_DIR: cacheDir(laneDir("e2e-real", lane)),
          APP8N8_CONFIG_DIR: cacheDir(laneDir("e2e-real-config", lane)),
          ...AUTO,
          APP8N8_HISTORY_DIR: cacheDir(laneDir("e2e-real-history", lane)),
        },
      },
      {
        // The same pipeline with no model chosen: the default model (CORE-21, FID-15).
        command: cli(lanePort(LANE_PORT.defaultModel, lane)),
        url: `http://127.0.0.1:${lanePort(LANE_PORT.defaultModel, lane)}`,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          APP8N8_TOKEN: E2E_TOKEN,
          ...NO_CLAUDE,
          APP8N8_PORT: String(lanePort(LANE_PORT.defaultModel, lane)),
          OPENROUTER_API_KEY: "e2e-fake-key",
          OPENROUTER_BASE_URL: `${fakeURL(lane)}/v1`,
          // Set and empty: an empty value counts as absent, so the default model is used.
          APP8N8_MODEL: "",
          APP8N8_REVIEW_MODEL: "",
          APP8N8_CACHE_DIR: cacheDir(laneDir("e2e-default-model", lane)),
          APP8N8_CONFIG_DIR: cacheDir(
            laneDir("e2e-default-model-config", lane),
          ),
          ...AUTO,
          APP8N8_HISTORY_DIR: cacheDir(
            laneDir("e2e-default-model-history", lane),
          ),
        },
      },
      {
        // Feature 08: no key, no automatic mode, a config of its own that the spec writes
        // through the settings dialog (configuracoes.e2e.ts).
        command: cli(lanePort(LANE_PORT.settings, lane)),
        url: `http://127.0.0.1:${lanePort(LANE_PORT.settings, lane)}`,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          APP8N8_TOKEN: E2E_TOKEN,
          ...NO_CLAUDE,
          APP8N8_PORT: String(lanePort(LANE_PORT.settings, lane)),
          OPENROUTER_API_KEY: "",
          // The URL only comes from here; the key and the rest go in through the dialog.
          OPENROUTER_BASE_URL: `${fakeURL(lane)}/v1`,
          APP8N8_MODEL: "e2e/drafter",
          APP8N8_REVIEW_MODEL: "e2e/reviewer",
          APP8N8_CACHE_DIR: cacheDir(laneDir("e2e-settings", lane)),
          APP8N8_HISTORY_DIR: cacheDir(laneDir("e2e-settings-history", lane)),
          APP8N8_CONFIG_DIR: cacheDir(laneDir("e2e-settings-config", lane)),
        },
      },
    ]),
  ],
});
