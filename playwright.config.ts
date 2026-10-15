import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const URL = "http://127.0.0.1:4317";
// Every test server runs with this session token, and every page request carries it (DIST-20).
// Obviously fake and low entropy, so gitleaks does not take it for a secret.
export const E2E_TOKEN = "e2e-session-token-not-a-secret-0000";
const repoRoot = dirname(fileURLToPath(import.meta.url));
const cacheDir = (name: string) => join(repoRoot, ".cache", name);

// These specs share the fake LLM's request log and the e2e-real cache (4319): they wipe
// and count them, so they run one at a time. Every other spec runs in parallel.
const SHARED_STATE = [
  "**/cache.e2e.ts",
  "**/detalhe.e2e.ts",
  "**/docstring.e2e.ts",
  "**/fidelidade.e2e.ts",
  "**/navegacao.e2e.ts",
  "**/sugestoes.e2e.ts",
  "**/titulos.e2e.ts",
];

export default defineConfig({
  testDir: "e2e",
  // *.e2e.ts, never *.test.ts or *.spec.ts: Vitest does not pick these up.
  testMatch: "**/*.e2e.ts",
  // Files run in parallel; the tests of one file keep their order.
  fullyParallel: false,
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
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: ["**/performance.e2e.ts", ...SHARED_STATE],
    },
    {
      name: "shared-state",
      use: { ...devices["Desktop Chrome"] },
      testMatch: SHARED_STATE,
      workers: 1,
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
  // Every variable below is set explicitly, so process.loadEnvFile never takes it from .env.
  webServer: [
    {
      // OpenAI-compatible fake LLM (e2e/fake-llm.ts); the keyed server talks only to it.
      command: "tsx e2e/fake-llm.ts",
      url: "http://127.0.0.1:4318/__log",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Builds apps/web and serves it with the real API, with no key (feature 01).
      command: "pnpm start",
      url: URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        APP8N8_TOKEN: E2E_TOKEN,
        // Set and empty: .env never supplies the key.
        OPENROUTER_API_KEY: "",
        // A cache dir of its own (<repo>/.cache/e2e-offline), apart from the user's entries;
        // with no key the server never writes.
        APP8N8_CACHE_DIR: cacheDir("e2e-offline"),
        // The history lives apart: the specs wipe the cache dir, never this one.
        APP8N8_HISTORY_DIR: cacheDir("e2e-offline-history"),
        APP8N8_MODEL: "e2e/offline",
      },
    },
    {
      // The real review pipeline against the fake LLM. It serves the apps/web/dist built by
      // the server above; serveStatic reads it per request, so start order does not matter.
      command: "tsx packages/server/src/main.ts start",
      url: "http://127.0.0.1:4319",
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        APP8N8_TOKEN: E2E_TOKEN,
        APP8N8_PORT: "4319",
        // A fake key and a local base URL: no request ever reaches openrouter.ai.
        OPENROUTER_API_KEY: "e2e-fake-key",
        OPENROUTER_BASE_URL: "http://127.0.0.1:4318/v1",
        APP8N8_MODEL: "e2e/drafter",
        APP8N8_REVIEW_MODEL: "e2e/reviewer",
        // Isolated cache, wiped by the specs before each test.
        APP8N8_CACHE_DIR: cacheDir("e2e-real"),
        APP8N8_HISTORY_DIR: cacheDir("e2e-real-history"),
      },
    },
    {
      // The same pipeline with no model chosen: the default model (CORE-21, FID-15).
      command: "tsx packages/server/src/main.ts start",
      url: "http://127.0.0.1:4320",
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        APP8N8_TOKEN: E2E_TOKEN,
        APP8N8_PORT: "4320",
        OPENROUTER_API_KEY: "e2e-fake-key",
        OPENROUTER_BASE_URL: "http://127.0.0.1:4318/v1",
        // Set and empty: process.loadEnvFile keeps them, so .env never supplies a model,
        // and an empty value counts as absent.
        APP8N8_MODEL: "",
        APP8N8_REVIEW_MODEL: "",
        APP8N8_CACHE_DIR: cacheDir("e2e-default-model"),
        APP8N8_HISTORY_DIR: cacheDir("e2e-default-model-history"),
      },
    },
    {
      // A keyless server of its own for historico.e2e.ts: that spec wipes and counts the
      // history, so the maps other specs open on 4317 at the same time stay out of it.
      command: "tsx packages/server/src/main.ts start",
      url: "http://127.0.0.1:4321",
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        APP8N8_TOKEN: E2E_TOKEN,
        APP8N8_PORT: "4321",
        OPENROUTER_API_KEY: "",
        APP8N8_CACHE_DIR: cacheDir("e2e-history-offline"),
        APP8N8_HISTORY_DIR: cacheDir("e2e-history"),
        APP8N8_MODEL: "e2e/offline",
      },
    },
  ],
});
