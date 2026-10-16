import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listenOnLoopback } from "./listen";
import { openUrl } from "./open-browser";
import { run } from "./run";

// The CLI run from the repository (pnpm dev): Vite serves the screen, and the PTS rules
// come from docs/. The installed package enters through bin.ts instead.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  home: homedir(),
  paths: {
    web: undefined,
    ptsRules: join(repoRoot, "docs/portugues-tecnico-simplificado.md"),
  },
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  serve: listenOnLoopback,
  openBrowser: openUrl,
});
