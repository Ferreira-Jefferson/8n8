import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listenOnLoopback } from "./listen";
import { openBrowser } from "./open-browser";
import { run } from "./run";

// In the package, this file is dist/cli.mjs: the screen and the PTS rules sit next to it.
const here = dirname(fileURLToPath(import.meta.url));

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  home: homedir(),
  paths: { web: join(here, "web"), ptsRules: join(here, "pts.md") },
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  serve: listenOnLoopback,
  openBrowser,
});
