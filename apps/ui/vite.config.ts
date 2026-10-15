import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative paths: the CLI serves the page at the root, the VS Code webview from a <base> (VSC-04).
  base: "./",
  plugins: [react()],
  server: {
    proxy: {
      // changeOrigin rewrites Host to 127.0.0.1:4317; the server refuses any other Host.
      // scripts/dev.mjs gives the server and this proxy the same session token (DIST-20).
      "/api": {
        target: "http://127.0.0.1:4317",
        changeOrigin: true,
        headers: { "x-8n8-token": process.env.APP8N8_TOKEN ?? "" },
      },
    },
  },
});
