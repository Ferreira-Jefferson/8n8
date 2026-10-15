import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";

// Opens a real VS Code on a copy of the loja fixture, with a user data folder and
// an extensions folder of its own: the user's editor is never touched (VSC-08).
const extRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const repoRoot = join(extRoot, "../../..");
const tmp = mkdtempSync(join(tmpdir(), "8n8-vscode-it-"));
const workspace = join(tmp, "loja");
cpSync(
  join(
    repoRoot,
    "packages/languages/python/src/__tests__/fixtures/projeto-loja",
  ),
  workspace,
  { recursive: true },
);

const suite = join(tmp, "suite.cjs");
await build({
  entryPoints: [join(extRoot, "src/__tests__/integration/suite.ts")],
  outfile: suite,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["vscode"],
  logLevel: "error",
});

// The installed VS Code when there is one (APP8N8_VSCODE_PATH or the default
// place on Windows); otherwise test-electron downloads the stable one.
const installed =
  process.env.APP8N8_VSCODE_PATH ??
  join(
    process.env.LOCALAPPDATA ?? "",
    "Programs",
    "Microsoft VS Code",
    "Code.exe",
  );

// A terminal inside VS Code inherits this; with it, Code.exe starts as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;

try {
  await runTests({
    extensionDevelopmentPath: extRoot,
    extensionTestsPath: suite,
    // VSC-06: a variable of the host's environment must reach the core.
    // The user-data folder lets the suite find VS Code's global storage on its own (VSC-05).
    extensionTestsEnv: {
      APP8N8_AUTO_SUMMARY: "1",
      APP8N8_TEST_USER_DATA: join(tmp, "user-data"),
    },
    ...(existsSync(installed) ? { vscodeExecutablePath: installed } : {}),
    launchArgs: [
      workspace,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--user-data-dir",
      join(tmp, "user-data"),
      "--extensions-dir",
      join(tmp, "extensions"),
    ],
  });
  console.log("8n8: teste de integração no VS Code passou.");
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    // VS Code may hold its folders for a moment after it closes.
  }
}
