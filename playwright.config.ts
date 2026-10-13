import { defineConfig, devices } from "@playwright/test";

const URL = "http://127.0.0.1:4317";

export default defineConfig({
  testDir: "e2e",
  // *.e2e.ts, never *.test.ts or *.spec.ts: Vitest does not pick these up.
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Builds apps/web and serves it with the real API (packages/server/src/main.ts).
    command: "pnpm start",
    url: URL,
    // Never reuse a running server: it may hold the real key from .env.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      // Set and empty: process.loadEnvFile does not override it, so .env never supplies the key.
      OPENROUTER_API_KEY: "",
      // The cache dir is fixed (<repo>/.cache/explain). A model name of its own keeps
      // the cache keys apart from the user's entries; with no key the server never writes.
      CODE2N8N_MODEL: "e2e/offline",
    },
  },
});
