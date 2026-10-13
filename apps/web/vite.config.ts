import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // changeOrigin rewrites Host to 127.0.0.1:4317; the server refuses any other Host.
      "/api": { target: "http://127.0.0.1:4317", changeOrigin: true },
    },
  },
});
