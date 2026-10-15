import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { bundle, copyGrammars } from "../build";

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "8n8-bundle-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe("bundle (DIST-12)", () => {
  it("parses Python and TypeScript from a bundle, with the grammars next to it", async () => {
    const file = join(out, "smoke.mjs");
    await bundle(join(here, "fixtures", "bundle-smoke.ts"), file);
    copyGrammars(out);
    expect(readdirSync(join(out, "grammars")).sort()).toEqual([
      "tree-sitter-python.wasm",
      "tree-sitter-tsx.wasm",
      "tree-sitter-typescript.wasm",
    ]);
    expect(existsSync(join(out, "web-tree-sitter.wasm"))).toBe(true);

    type Smoke = { extractBoth(): Record<string, string[]> };
    const bundled = (await import(pathToFileURL(file).href)) as Smoke;
    const source = (await import("./fixtures/bundle-smoke")) as Smoke;
    const expected = source.extractBoth();
    // The bundle gives the same graph as the source plugins, for both languages.
    expect(Object.keys(expected)).toEqual(["python", "typescript"]);
    expect(expected.python?.length).toBeGreaterThan(1);
    expect(expected.typescript?.length).toBeGreaterThan(1);
    expect(bundled.extractBoth()).toEqual(expected);
  });
});

describe("the published package.json (DIST-12, DIST-16)", () => {
  const pkg = JSON.parse(
    readFileSync(join(here, "..", "..", "package.json"), "utf8"),
  ) as Record<string, unknown>;

  it("declares no dependencies: third-party code goes inside the bundle", () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });

  it("has no install scripts", () => {
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
      expect(scripts[hook]).toBeUndefined();
    }
  });

  it("ships only dist, runs dist/8n8.mjs as 8n8 and asks Node 22.13 or newer", () => {
    expect(pkg.files).toEqual(["dist"]);
    expect(pkg.bin).toEqual({ "8n8": "dist/8n8.mjs" });
    expect(pkg.engines).toEqual({ node: ">=22.13.0" });
  });
});
