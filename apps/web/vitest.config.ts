import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    setupFiles: ["src/__tests__/setup.tsx"],
    // Lets src/__tests__/styles.test.ts read the app's CSS with `?raw`.
    css: { include: [/\/src\/styles\.css/] },
  },
});
