import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listenOnLoopback } from "./listen";
import { openUrl } from "./open-browser";
import { run } from "./run";

// In the package, this file is dist/cli.mjs: the screen and the PTS and STE rules sit next to it.
const here = dirname(fileURLToPath(import.meta.url));
// package.json sits at the package root, one level above dist/.
const version = (
  JSON.parse(readFileSync(join(here, "../package.json"), "utf8")) as {
    version: string;
  }
).version;

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  home: homedir(),
  version,
  paths: {
    web: join(here, "web"),
    ptsRules: join(here, "pts.md"),
    steRules: join(here, "ste.md"),
    analysisWorker: join(here, "analysis-worker.mjs"),
  },
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  serve: listenOnLoopback,
  openBrowser: openUrl,
});
