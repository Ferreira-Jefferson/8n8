import type { SourceFile } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { typescriptPlugin } from "../index";
import { packageInfo, tsconfigInfo } from "../modules";

const sources = (files: Record<string, string>): SourceFile[] =>
  Object.entries(files).map(([path, source]) => ({ path, source }));

const analyze = (files: Record<string, string>) =>
  typescriptPlugin.analyze(sources(files));

const importPairs = (files: Record<string, string>) =>
  analyze(files).imports.map((e) => `${e.source} -> ${e.target}`);

/** The target of the first step of `main` in `app/src/main.ts`. */
const mainTarget = (files: Record<string, string>) =>
  analyze(files)
    .files.find((f) => f.path === "app/src/main.ts")
    ?.graph.nodes.find((n) => n.id === "file:app/src/main.ts/fn:main/s0");

const monorepo = {
  "core/package.json": '{ "name": "@acme/core", "main": "src/index.ts" }',
  "core/src/index.ts": "export function coreFn() {\n  return 1;\n}\n",
  "app/package.json": '{ "name": "@acme/app" }',
  "app/src/main.ts":
    'import { coreFn } from "@acme/core";\nexport function main() {\n  return coreFn();\n}\n',
};

describe("workspace packages", () => {
  it("wires an import of a workspace package to the file its package.json names", () => {
    expect(importPairs(monorepo)).toEqual([
      "file:app/src/main.ts -> file:core/src/index.ts",
    ]);
    expect(mainTarget(monorepo)).toMatchObject({
      kind: "return",
      target: "file:core/src/index.ts/fn:coreFn",
    });
  });

  it("gives no graph for a package.json or a tsconfig.json", () => {
    const files = analyze({
      ...monorepo,
      "tsconfig.json": "{}",
    }).files.map((f) => f.path);

    expect(files).toEqual(["app/src/main.ts", "core/src/index.ts"]);
  });

  it.each([
    ['{ "name": "@acme/core", "exports": { ".": "./src/index.ts" } }'],
    ['{ "name": "@acme/core", "exports": "./src/index.ts" }'],
    [
      '{ "name": "@acme/core", "exports": { ".": { "types": "./dist/index.d.ts", "import": "./src/index.js" } } }',
    ],
    ['{ "name": "@acme/core", "types": "src/index.ts" }'],
    ['{ "name": "@acme/core", "main": "dist/index.js" }'],
    ['{ "name": "@acme/core" }'],
  ])("finds the entry of %s", (manifest) => {
    expect(importPairs({ ...monorepo, "core/package.json": manifest })).toEqual(
      ["file:app/src/main.ts -> file:core/src/index.ts"],
    );
  });

  it("finds a subpath through `exports`, a `*` pattern, or the folder", () => {
    const files = {
      "core/package.json":
        '{ "name": "core", "exports": { "./db": "./src/db/client.ts", "./util/*": "./src/util/*.ts" } }',
      "core/src/db/client.ts": "export function q() {}\n",
      "core/src/util/text.ts": "export function t() {}\n",
      "core/src/plain.ts": "export function p() {}\n",
      "app/src/main.ts":
        'import { q } from "core/db";\nimport { t } from "core/util/text";\nimport { p } from "core/plain";\n',
    };

    expect(importPairs(files)).toEqual([
      "file:app/src/main.ts -> file:core/src/db/client.ts",
      "file:app/src/main.ts -> file:core/src/util/text.ts",
      "file:app/src/main.ts -> file:core/src/plain.ts",
    ]);
  });

  it("leaves a package that is not in the workspace outside", () => {
    expect(
      importPairs({
        ...monorepo,
        "app/src/main.ts": 'import { x } from "@acme/other";\n',
      }),
    ).toEqual([]);
  });

  it("gives the same answer in slices as in one piece", () => {
    const files = sources(monorepo);
    const whole = typescriptPlugin.analyze(files);
    const slices = [files.slice(0, 2), files.slice(2)].map((part) =>
      typescriptPlugin.openSlice?.(part),
    );
    const contributions = slices
      .flatMap((s) => s?.contribute() ?? [])
      .sort((a, b) => (a.path < b.path ? -1 : 1));
    const parts = slices.map((s) => s?.analyze(contributions));
    for (const s of slices) s?.dispose();

    expect(parts.flatMap((p) => p?.imports ?? [])).toEqual(whole.imports);
  });
});

describe("tsconfig paths", () => {
  const project = {
    "tsconfig.json":
      '{\n  // aliases\n  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], "#lib": ["src/lib/index.ts"], }, },\n}\n',
    "src/lib/index.ts": "export function add() {}\n",
    "src/lib/math.ts": "export function mul() {}\n",
    "src/main.ts":
      'import { add } from "#lib";\nimport { mul } from "@/lib/math";\n',
  };

  it("wires an alias of the tsconfig, comments and trailing commas allowed", () => {
    expect(importPairs(project)).toEqual([
      "file:src/main.ts -> file:src/lib/index.ts",
      "file:src/main.ts -> file:src/lib/math.ts",
    ]);
  });

  it("reads the paths relative to the tsconfig folder without baseUrl", () => {
    expect(
      importPairs({
        "web/tsconfig.json":
          '{ "compilerOptions": { "paths": { "~/*": ["./app/*"] } } }',
        "web/app/x.ts": "export function x() {}\n",
        "web/main.ts": 'import { x } from "~/x";\n',
        "other/main.ts": 'import { x } from "~/x";\n',
      }),
    ).toEqual(["file:web/main.ts -> file:web/app/x.ts"]);
  });
});

describe("manifest texts", () => {
  it("reads nothing from a broken text", () => {
    expect(packageInfo("{")).toBeNull();
    expect(packageInfo('{ "version": "1" }')).toBeNull();
    expect(tsconfigInfo("{")).toBeNull();
    expect(tsconfigInfo('{ "compilerOptions": {} }')).toBeNull();
  });

  it("keeps a // inside a string of a tsconfig", () => {
    expect(
      tsconfigInfo(
        '{ "$schema": "https://x.org/a", "compilerOptions": { "paths": { "a": ["b"] } } }',
      ),
    ).toEqual({ baseUrl: null, paths: [["a", ["b"]]] });
  });
});
