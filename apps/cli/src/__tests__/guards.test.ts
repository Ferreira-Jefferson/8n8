import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// The guards are tested by their property, not by their config: each case writes rule
// breakers into a temp folder that holds the real guard config and runs the real
// `pnpm check` script there. A config, script or ignore change that lets a breaker pass
// fails here (DIST-14, DIST-23).

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../../..");
const CONFIG = [
  "package.json",
  "biome.json",
  ".dependency-cruiser.cjs",
  "tsconfig.base.json",
  ".gitignore",
];

/** Every workspace folder, plus a host that does not exist yet (apps/editors/vscode). */
const workspaces = [
  ...["packages", "packages/languages", "apps", "apps/editors"].flatMap(
    (parent) =>
      readdirSync(join(repo, parent))
        .map((name) => `${parent}/${name}`)
        .filter((dir) => existsSync(join(repo, dir, "package.json"))),
  ),
  "apps/editors/vscode",
].filter((dir, i, all) => all.indexOf(dir) === i);
const packages = workspaces.filter((w) => w.startsWith("packages/"));

const SPAWN =
  'import { spawn } from "node:child_process";\n\nexport const probe = spawn;\n';
const importOf = (from: string, to: string) =>
  `import { probe as target } from "${posix.relative(posix.dirname(from), to)}";\n\nexport const probe = target;\n`;

const VSCODE =
  'import * as vscode from "vscode";\n\nexport const probe = vscode;\n';
const importing = (module: string) =>
  `import * as m from "${module}";\n\nexport const probe = m;\n`;

/** Clean files every case starts from: one per workspace, the import targets and the two exemptions. */
const BASE: Record<string, string> = {
  ...Object.fromEntries(
    workspaces.map((w) => [`${w}/src/clean.ts`, "export const probe = 1;\n"]),
  ),
  "apps/cli/src/run.ts": "export const probe = 1;\n",
  "apps/web/src/target.ts": "export const probe = 1;\n",
  "apps/cli/src/open-browser.ts": SPAWN,
  "packages/llm/src/claude-code.ts": SPAWN,
  "apps/cli/src/__tests__/guards.test.ts": SPAWN,
  // The extension may import vscode (VSC-13).
  "apps/editors/vscode/src/editor.ts": VSCODE,
};

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** Runs the repository's `check` script on BASE plus `files`, as `pnpm check` does. */
function check(files: Record<string, string>): { status: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "8n8-guards-"));
  temps.push(dir);
  for (const name of CONFIG) cpSync(join(repo, name), join(dir, name));
  for (const [file, text] of Object.entries({ ...BASE, ...files })) {
    mkdirSync(join(dir, dirname(file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  const script = (
    JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts.check;
  const env = { ...process.env };
  const path =
    Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  env[path] =
    join(repo, "node_modules", ".bin") + delimiter + (env[path] ?? "");
  const r = spawnSync(script ?? "", {
    cwd: dir,
    env,
    shell: true,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

/** Biome diagnostics as "file rule severity", × being an error. */
function biomeFindings(out: string): string[] {
  return [...out.matchAll(/^(\S+):\d+:\d+ (\S+) ━+\r?\n\r?\n\s+(\S) /gm)].map(
    ([, file, rule, mark]) =>
      `${file?.replaceAll("\\", "/")} ${rule} ${mark === "×" ? "error" : "not-error"}`,
  );
}

/** dependency-cruiser violations as "severity rule: from". */
function cruiseFindings(out: string): string[] {
  return [...out.matchAll(/^\s*(\S+) (\S+): (\S+) → /gm)].map(
    ([, severity, rule, from]) => `${severity} ${rule}: ${from}`,
  );
}

describe("pnpm check guards, run for real on rule breakers (DIST-14, DIST-23)", () => {
  it("passes the clean base, open-browser.ts, claude-code.ts and this test included", () => {
    const { status, out } = check({});
    expect(out).not.toMatch(/error|×/i);
    expect(status).toBe(0);
  });

  // One run per workspace: Biome prints at most 20 diagnostics per run.
  it.each(workspaces)(
    "fails eval, new Function and dangerouslySetInnerHTML in %s",
    (w) => {
      const { status, out } = check({
        [`${w}/src/probe-eval.ts`]:
          "export const probe = (code: string) => eval(code);\n",
        [`${w}/src/probe-function.ts`]:
          "export const probe = (body: string) => new Function(body);\n",
        [`${w}/src/probe-html.tsx`]:
          "export const probe = (props: { html: string }) => (\n  <div dangerouslySetInnerHTML={{ __html: props.html }} />\n);\n",
      });
      expect(biomeFindings(out).sort()).toEqual([
        `${w}/src/probe-eval.ts lint/security/noGlobalEval error`,
        `${w}/src/probe-function.ts lint/style/noRestrictedGlobals error`,
        `${w}/src/probe-html.tsx lint/security/noDangerouslySetInnerHtml error`,
      ]);
      expect(status).not.toBe(0);
    },
  );

  it("fails node:child_process anywhere but open-browser.ts, claude-code.ts and this test (CC-09)", () => {
    const files: Record<string, string> = {
      "apps/cli/src/spawns.ts": SPAWN,
      "apps/cli/src/__tests__/other.test.ts": SPAWN,
      "packages/server/src/probe-dynamic.ts":
        'export const probe = () => import("node:child_process");\n',
      // cluster.fork() starts a Node process without naming child_process (SEC-08).
      "packages/server/src/probe-cluster.ts":
        'import cluster from "node:cluster";\n\nexport const probe = cluster;\n',
      "apps/editors/vscode/src/probe-cluster.ts":
        'import cluster from "cluster";\n\nexport const probe = cluster;\n',
    };
    for (const w of workspaces) files[`${w}/src/probe-spawn.ts`] = SPAWN;
    const { status, out } = check(files);
    const found = cruiseFindings(out);
    for (const file of Object.keys(files)) {
      expect(found).toContain(`error no-child-process: ${file}`);
    }
    expect(found.join("\n")).not.toMatch(
      /open-browser|claude-code|guards\.test/,
    );
    expect(status).not.toBe(0);
  });

  it("fails a package or a host that imports another host", () => {
    const toCli = "apps/cli/src/run.ts";
    const files: Record<string, string> = {
      "apps/web/src/probe-host.ts": importOf(
        "apps/web/src/probe-host.ts",
        toCli,
      ),
      "apps/editors/vscode/src/probe-host.ts": importOf(
        "apps/editors/vscode/src/probe-host.ts",
        toCli,
      ),
      "apps/cli/src/probe-host.ts": importOf(
        "apps/cli/src/probe-host.ts",
        "apps/web/src/target.ts",
      ),
    };
    for (const w of packages) {
      files[`${w}/src/probe-cli.ts`] = importOf(`${w}/src/probe-cli.ts`, toCli);
    }
    const { status, out } = check(files);
    const found = cruiseFindings(out);
    for (const host of ["apps/web", "apps/editors/vscode", "apps/cli"]) {
      expect(found).toContain(
        `error hosts-do-not-import-each-other: ${host}/src/probe-host.ts`,
      );
    }
    // A boundary rule of the package itself, not only the relative-path hygiene rule.
    for (const w of packages) {
      expect(
        found.filter(
          (f) =>
            f.startsWith("error ") &&
            f.endsWith(`: ${w}/src/probe-cli.ts`) &&
            !f.includes("no-relative-escape"),
        ),
      ).not.toEqual([]);
    }
    expect(status).not.toBe(0);
  });

  it("fails vscode outside the extension, and a port inside it (VSC-09, VSC-13)", () => {
    const outside = [
      "packages/server/src/probe-vscode.ts",
      // A .vscode-test folder anywhere else is code like any other.
      "packages/server/.vscode-test/probe-vscode.ts",
      "packages/model/src/probe-vscode.ts",
      "apps/web/src/probe-vscode.ts",
      "apps/cli/src/probe-vscode.ts",
    ];
    const ports = ["@hono/node-server", "node:http", "node:https", "node:net"];
    const files: Record<string, string> = Object.fromEntries([
      ...outside.map((f) => [f, VSCODE]),
      ...ports.map((m, i) => [
        `apps/editors/vscode/src/probe-port${i}.ts`,
        importing(m),
      ]),
    ]);
    const { status, out } = check(files);
    const found = cruiseFindings(out);
    for (const file of outside) {
      expect(found).toContain(`error only-vscode-host-imports-vscode: ${file}`);
    }
    for (const i of ports.keys()) {
      expect(found).toContain(
        `error vscode-opens-no-port: apps/editors/vscode/src/probe-port${i}.ts`,
      );
    }
    expect(found.join("\n")).not.toContain("apps/editors/vscode/src/editor.ts");
    expect(status).not.toBe(0);
  });
});

/** Files under packages/ and apps/ of `root`, without dependencies and build output. */
function sourcesOf(root: string): string[] {
  return ["packages", "apps"].flatMap(function walk(dir: string): string[] {
    return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(
      (e) => {
        const path = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          // The VS Code the extension test downloads, only at its one place.
          return ["node_modules", "dist", ".cache"].includes(e.name) ||
            path === "apps/editors/vscode/.vscode-test"
            ? []
            : walk(path);
        }
        return /\.(c|m)?(t|j)sx?$/.test(e.name) ? [path] : [];
      },
    );
  });
}

describe("source scan: what the check cannot see (DIST-23)", () => {
  const sources = sourcesOf(repo);

  it("walks a .vscode-test folder anywhere but the extension's download", () => {
    const root = mkdtempSync(join(tmpdir(), "8n8-scan-"));
    temps.push(root);
    for (const file of [
      "packages/server/.vscode-test/x.ts",
      "apps/editors/vscode/.vscode-test/y.ts",
      "apps/editors/vscode/src/z.ts",
    ]) {
      mkdirSync(join(root, dirname(file)), { recursive: true });
      writeFileSync(join(root, file), "export {};\n");
    }
    expect(sourcesOf(root).sort()).toEqual([
      "apps/editors/vscode/src/z.ts",
      "packages/server/.vscode-test/x.ts",
    ]);
  });

  // The code that ships lives in src/; tests and their fixtures do not ship.
  const shipped = sources.filter(
    (f) => f.includes("/src/") && !f.includes("/__tests__/"),
  );
  const text = (file: string) => readFileSync(join(repo, file), "utf8");

  it("no comment silences the security rules or the whole linter", () => {
    const silencer =
      /biome-ignore(?:-all|-start)?\s+lint(?:[\s:(]|\/security\b|\/style\/noRestrictedGlobals)/;
    expect(sources.filter((f) => silencer.test(text(f)))).toEqual([]);
  });

  // Pinned by line, not by file: a new line in links.ts (getBuiltinModule, a
  // createRequire of child_process) fails here even though the file is listed.
  it("only open-browser.ts and claude-code.ts reach child_process; links.ts only names it as analysed code (CC-10)", () => {
    const lines = shipped
      .filter(
        (f) =>
          f !== "apps/cli/src/open-browser.ts" &&
          f !== "packages/llm/src/claude-code.ts",
      )
      .flatMap((f) =>
        text(f)
          .split("\n")
          .filter((line) => /child_process|getBuiltinModule/.test(line))
          .map((line) => `${f}: ${line.trim()}`),
      );
    expect(lines).toEqual([
      'packages/languages/typescript/src/links.ts: // Request: `child_process.exec("node b.ts")`.',
      'packages/languages/typescript/src/links.ts: if (lib === "child_process" && PROCESS_CALLS.has(processFn ?? "")) {',
    ]);
  });

  it("shipped code imports nothing from __tests__ (the check skips fixtures)", () => {
    expect(
      shipped.filter((f) => /["'][^"'\n]*__tests__\//.test(text(f))),
    ).toEqual([]);
  });

  it("gitleaks has no allowlist and no ignore file", () => {
    expect(text(".gitleaks.toml")).not.toMatch(/allowlist/i);
    expect(existsSync(join(repo, ".gitleaksignore"))).toBe(false);
  });
});
