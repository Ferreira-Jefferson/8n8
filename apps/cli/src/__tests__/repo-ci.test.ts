import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

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

  // A top-level defaults or env changes every job: a shell without -e lets a failed
  // checksum through, an env can swap the gitleaks rules (SEC-01).
  it.each(workflows)(
    "$name has only name, on, permissions and jobs at the top",
    ({ text }) => {
      const keys = text
        .split(/\r?\n/)
        .filter((l) => /^[A-Za-z_]/.test(l))
        .map((l) => l.split(":")[0]);
      expect(keys).toEqual(["name", "on", "permissions", "jobs"]);
    },
  );

  it.each(workflows)(
    "$name never hides a failure with || true or exit 0",
    ({ text }) => {
      expect(text).not.toMatch(/\|\|\s*true|\bexit 0\b/);
    },
  );

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

  it("never skips a step nor lets a job fail quietly", () => {
    expect(ci).not.toMatch(/^\s*if:/m);
    expect(ci).not.toMatch(/continue-on-error/);
  });

  it("is the secrets job exactly: a full checkout, a checksummed gitleaks, a full scan with .gitleaks.toml", () => {
    // Line by line: nothing can be added around the checksum or the scan (SEC-01, SEC-05).
    expect(jobBlock(ci, "secrets").split("\n")).toEqual([
      "  secrets:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 10",
      "    steps:",
      "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
      "        with:",
      "          fetch-depth: 0",
      "          persist-credentials: false",
      "      # The gitleaks CLI at a fixed release, checked by its SHA-256, over every",
      "      # commit of the history with the rules of .gitleaks.toml (SEC-01).",
      "      - name: gitleaks",
      "        env:",
      "          GITLEAKS_VERSION: 8.30.1",
      "          GITLEAKS_SHA256: 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
      "        run: |",
      '          curl -sSfL -o gitleaks.tgz "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"',
      '          echo "${GITLEAKS_SHA256}  gitleaks.tgz" | sha256sum --check --strict',
      "          tar -xzf gitleaks.tgz gitleaks",
      "          ./gitleaks git --redact --verbose --no-banner .",
      "",
    ]);
  });

  it("gives no job more permissions than the top", () => {
    expect(ci).not.toMatch(/^ {4}permissions:/m);
  });

  it("scans every commit with the gitleaks CLI of a fixed release, checked by its SHA-256", () => {
    const secrets = jobBlock(ci, "secrets");
    expect(secrets).toMatch(/^ {10}fetch-depth: 0$/m);
    expect(secrets).toMatch(/GITLEAKS_VERSION: \d+\.\d+\.\d+$/m);
    expect(secrets).toMatch(/GITLEAKS_SHA256: [0-9a-f]{64}$/m);
    expect(secrets).toMatch(/sha256sum --check --strict/);
    // A full scan of the repository, never a log range.
    expect(secrets).toMatch(
      /\.\/gitleaks git --redact --verbose --no-banner \.$/m,
    );
    expect(secrets).not.toMatch(/log-opts/);
    expect(ci).not.toMatch(/gitleaks\/gitleaks-action/);
  });
});

/** The lines of one job, from `  <name>:` to the next job. */
function jobBlock(text: string, name: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && /^ {2}\S/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

describe("CodeQL and Dependabot (SEC-03, SEC-04)", () => {
  const codeql = read(".github/workflows/codeql.yml");

  it("analyses JavaScript and TypeScript on pull requests, pushes to main and every week", () => {
    expect(codeql).toMatch(/languages: javascript-typescript/);
    expect(topBlock(codeql, "on")).toEqual([
      "pull_request:",
      "push:",
      "branches: [main]",
      "schedule:",
      '- cron: "17 6 * * 1"',
    ]);
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
      "fora da pasta analisada",
      "## Versão suportada",
      "exija pull request",
      "status checks",
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

// Parsed, not read as text: quoted keys, flow maps and other YAML spellings
// cannot slip past (SEC-01, SEC-02, SEC-05).
describe("the workflows as YAML (SEC-01, SEC-02, SEC-05)", () => {
  type Step = Record<string, unknown> & { run?: string };
  type Job = Record<string, unknown> & { steps: Step[] };
  const parsed = workflows.map((w) => ({
    name: w.name,
    doc: parse(w.text) as Record<string, unknown> & {
      jobs: Record<string, Job>;
    },
  }));

  it.each(parsed)(
    "$name has exactly name, on, permissions and jobs at the top",
    ({ doc }) => {
      expect(Object.keys(doc)).toEqual(["name", "on", "permissions", "jobs"]);
      expect(doc.permissions).toEqual({ contents: "read" });
    },
  );

  it.each(parsed)(
    "$name has no job that runs conditionally, quietly or with its own defaults",
    ({ doc }) => {
      for (const job of Object.values(doc.jobs)) {
        for (const key of ["if", "continue-on-error", "defaults", "env"]) {
          expect(job).not.toHaveProperty(key);
        }
        for (const step of job.steps) {
          for (const key of ["if", "continue-on-error", "shell"]) {
            expect(step).not.toHaveProperty(key);
          }
          expect(step.run ?? "").not.toMatch(/\|\|\s*(true|:)|\bexit\s+0\b/);
        }
      }
    },
  );

  it("gives job permissions only to the CodeQL analysis", () => {
    for (const { name, doc } of parsed) {
      for (const [id, job] of Object.entries(doc.jobs)) {
        if (name === "codeql.yml" && id === "analyze") {
          expect(job.permissions).toEqual({
            contents: "read",
            "security-events": "write",
          });
        } else {
          expect(job).not.toHaveProperty("permissions");
        }
      }
    }
  });

  it("gives env only to the gitleaks step, with exactly its version and checksum", () => {
    const withEnv = parsed.flatMap(({ doc }) =>
      Object.values(doc.jobs).flatMap((job) =>
        job.steps.filter((s) => "env" in s),
      ),
    );
    expect(withEnv).toHaveLength(1);
    expect(withEnv[0]?.name).toBe("gitleaks");
    expect(Object.keys(withEnv[0]?.env as object)).toEqual([
      "GITLEAKS_VERSION",
      "GITLEAKS_SHA256",
    ]);
  });
});

describe("the gates job, step by step (SEC-01)", () => {
  it("is exactly checkout, pnpm, node, install and the five gates: no extra step can disarm one", () => {
    const doc = parse(read(".github/workflows/ci.yml")) as {
      jobs: { gates: { steps: Record<string, unknown>[] } };
    };
    expect(doc.jobs.gates.steps).toEqual([
      {
        uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        with: { "persist-credentials": false },
      },
      { uses: "pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413" },
      {
        uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
        with: { "node-version": 22, cache: "pnpm" },
      },
      { run: "pnpm install --frozen-lockfile" },
      { run: "pnpm typecheck" },
      { run: "pnpm check" },
      { run: "pnpm test" },
      { run: "pnpm exec playwright install --with-deps chromium" },
      { run: "pnpm e2e" },
    ]);
  });
});
