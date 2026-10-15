import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise } from "dependency-cruiser";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../../..");
const fixtures = join(here, "fixtures", "guards");
// The real rules of `pnpm check`, run on fixtures shaped like the repository.
const { forbidden } = createRequire(import.meta.url)(
  join(repo, ".dependency-cruiser.cjs"),
) as { forbidden: object[] };

async function violations(): Promise<string[]> {
  const result = await cruise(["packages", "apps"], {
    baseDir: fixtures,
    validate: true,
    ruleSet: { forbidden } as never,
    tsPreCompilationDeps: true,
  });
  const output = result.output as {
    summary: {
      violations: { from: string; to: string; rule: { name: string } }[];
    };
  };
  return output.summary.violations.map(
    (v) => `${v.rule.name}: ${v.from} -> ${v.to}`,
  );
}

describe("pnpm check guards (DIST-14, DIST-23)", () => {
  it("fails a package that imports node:child_process", async () => {
    expect(await violations()).toContainEqual(
      expect.stringMatching(
        /^no-child-process: packages\/model\/src\/spawn\.ts -> /,
      ),
    );
  });

  it("lets apps/cli/src/open-browser.ts import node:child_process", async () => {
    expect(
      (await violations()).filter((v) => v.includes("open-browser")),
    ).toEqual([]);
  });

  it("fails the screen and another host that import apps/cli", async () => {
    const found = await violations();
    expect(found).toContainEqual(
      expect.stringMatching(
        /apps\/web\/src\/uses-cli\.ts -> apps\/cli\/src\/run\.ts$/,
      ),
    );
    expect(found).toContainEqual(
      expect.stringMatching(
        /^hosts-do-not-import-each-other: apps\/vscode\/src\/uses-cli\.ts -> apps\/cli\/src\/run\.ts$/,
      ),
    );
  });
});

describe("Biome security rules are explicit errors (DIST-23)", () => {
  const rules = (
    JSON.parse(readFileSync(join(repo, "biome.json"), "utf8")) as {
      linter: { rules: Record<string, Record<string, unknown>> };
    }
  ).linter.rules;

  it("forbids eval and dangerouslySetInnerHTML", () => {
    expect(rules.security?.noGlobalEval).toBe("error");
    expect(rules.security?.noDangerouslySetInnerHtml).toBe("error");
  });

  it("forbids the Function global (new Function runs text as code)", () => {
    const rule = rules.style?.noRestrictedGlobals as {
      level: string;
      options: { deniedGlobals: Record<string, string> };
    };
    expect(rule.level).toBe("error");
    expect(Object.keys(rule.options.deniedGlobals)).toContain("Function");
  });
});
