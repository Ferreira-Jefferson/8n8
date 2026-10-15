import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const workflowsDir = join(repo, ".github/workflows");
const workflows = readdirSync(workflowsDir)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ name: f, text: readFileSync(join(workflowsDir, f), "utf8") }));
const read = (file: string) => readFileSync(join(repo, file), "utf8");

/** The keys of a top-level block, e.g. permissions:, as "key: value" lines. */
function topBlock(text: string, key: string): string[] | undefined {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `${key}:`);
  if (start < 0) return undefined;
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s/.test(line)) break;
    if (line.trim() && !line.trim().startsWith("#")) block.push(line.trim());
  }
  return block;
}

describe("the workflows (SEC-02)", () => {
  it("finds the CI and the CodeQL workflows", () => {
    expect(workflows.map((w) => w.name).sort()).toEqual([
      "ci.yml",
      "codeql.yml",
    ]);
  });

  it.each(workflows)("$name pins every action to a commit SHA", ({ text }) => {
    const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map(
      (m) => m[1] ?? "",
    );
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/);
  });

  it.each(workflows)("$name reads only, at the top", ({ text }) => {
    expect(topBlock(text, "permissions")).toEqual(["contents: read"]);
  });

  it.each(workflows)("$name never runs on pull_request_target", ({ text }) => {
    expect(text).not.toMatch(/pull_request_target/);
  });
});

describe("the CI runs every gate (SEC-01)", () => {
  const ci = read(".github/workflows/ci.yml");

  it("runs on pull requests and on pushes to main", () => {
    expect(topBlock(ci, "on")).toEqual([
      "pull_request:",
      "push:",
      "branches: [main]",
    ]);
  });

  it.each([
    "pnpm install --frozen-lockfile",
    "pnpm typecheck",
    "pnpm check",
    "pnpm test",
    "pnpm e2e",
  ])("runs %s", (command) => {
    expect(ci).toMatch(new RegExp(`^\\s*- run: ${command}$`, "m"));
  });

  it("scans the whole history with gitleaks", () => {
    expect(ci).toMatch(/uses: gitleaks\/gitleaks-action@[0-9a-f]{40}/);
    expect(ci).toMatch(/fetch-depth: 0/);
  });
});

describe("CodeQL and Dependabot (SEC-03, SEC-04)", () => {
  const codeql = read(".github/workflows/codeql.yml");

  it("analyses JavaScript and TypeScript on pull requests, pushes to main and every week", () => {
    expect(codeql).toMatch(/languages: javascript-typescript/);
    expect(topBlock(codeql, "on")).toEqual(
      expect.arrayContaining(["pull_request:", "push:", "schedule:"]),
    );
    expect(codeql).toMatch(/uses: github\/codeql-action\/analyze@/);
  });

  it("writes security results only inside the analysis job", () => {
    const writes = codeql
      .split(/\r?\n/)
      .filter((l) => /security-events:\s*write/.test(l));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^ {6}security-events: write$/);
  });

  it("updates npm and the actions every week", () => {
    const dependabot = read(".github/dependabot.yml");
    for (const ecosystem of ["npm", "github-actions"]) {
      expect(dependabot).toMatch(
        new RegExp(
          `package-ecosystem: ${ecosystem}\\n\\s+directory: /\\n\\s+schedule:\\n\\s+interval: weekly`,
        ),
      );
    }
  });
});

describe("the security policy and its owners (SEC-06, SEC-07)", () => {
  it("SECURITY.md says how to report in private, what counts and how to protect the branch", () => {
    const policy = read("SECURITY.md");
    for (const part of [
      "Report a vulnerability",
      "chave",
      "Claude Code",
      "porta",
      "no-child-process",
      "CODEOWNERS",
      "force push",
    ]) {
      expect(policy).toContain(part);
    }
  });

  it("CODEOWNERS covers the workflows, Dependabot and the policy", () => {
    const owners = read(".github/CODEOWNERS");
    for (const path of [
      "/.github/workflows/",
      "/.github/dependabot.yml",
      "/SECURITY.md",
    ]) {
      expect(owners).toMatch(
        new RegExp(`^${path.replaceAll(".", "\\.")} @Ferreira-Jefferson$`, "m"),
      );
    }
  });
});
