import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listenOnLoopback } from "./listen";
import { openUrl } from "./open-browser";
import { run } from "./run";

// The CLI run from the repository (pnpm dev): Vite serves the screen, and the PTS rules
// come from docs/. The installed package enters through bin.ts instead.
const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(cliRoot, "../..");
const version = (
  JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8")) as {
    version: string;
  }
).version;

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  home: homedir(),
  version,
  paths: {
    web: undefined,
    ptsRules: join(
      repoRoot,
      "docs/writing-rules/portugues-tecnico-simplificado.md",
    ),
    steRules: join(
      repoRoot,
      "docs/writing-rules/ingles-tecnico-simplificado.md",
    ),
  },
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  serve: listenOnLoopback,
  openBrowser: openUrl,
});
