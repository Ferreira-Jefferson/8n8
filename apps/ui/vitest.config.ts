import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // One jsdom per worker, not per file, and each file still in a context of its own:
    // half the time of the default pool.
    pool: "vmThreads",
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    setupFiles: ["src/__tests__/setup.tsx"],
    // Lets src/__tests__/styles.test.ts read the app's CSS with `?raw`.
    css: { include: [/\/src\/styles\.css/] },
  },
});
