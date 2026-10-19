import type { FlowNode, SourceFile } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { typescriptPlugin } from "../index";
import { extract } from "./helpers";

const analyze = (files: Record<string, string>) =>
  typescriptPlugin.analyze(
    Object.entries(files).map(
      ([path, source]): SourceFile => ({ path, source }),
    ),
  );

/** The steps that reach a function or a method, as `label -> target`, and the external ones, as `label: category`. */
function calls(nodes: FlowNode[]): string[] {
  return nodes.flatMap((n) =>
    n.target?.includes("/fn:") === true
      ? [`${n.label} -> ${n.target}`]
      : n.kind === "external"
        ? [`${n.label}: ${n.category}`]
        : [],
  );
}

const fileCalls = (files: Record<string, string>, path: string) =>
  calls(analyze(files).files.find((f) => f.path === path)?.graph.nodes ?? []);

const repo =
  "export class Repo {\n  find(id: string) {\n    return id;\n  }\n  static create() {\n    return new Repo();\n  }\n}\n";

describe("methods of the project's classes", () => {
  it("resolves a static method of an imported class, and a field typed by a parameter property", () => {
    expect(
      fileCalls(
        {
          "repo.ts": repo,
          "service.ts":
            'import { Repo } from "./repo";\nexport class Service {\n  constructor(private repo: Repo) {}\n  get(id: string) {\n    Repo.create();\n    return this.repo.find(id);\n  }\n}\n',
        },
        "service.ts",
      ),
    ).toEqual([
      "Repo.create -> file:repo.ts/cls:Repo/fn:create",
      "this.repo.find(id) -> file:repo.ts/cls:Repo/fn:find",
    ]);
  });

  it("resolves a method of `x = new C()` in the blocks around the call", () => {
    expect(
      fileCalls(
        {
          "repo.ts": repo,
          "main.ts":
            'import { Repo } from "./repo";\nconst svc = new Repo();\nfunction run() {\n  const u = new Repo();\n  u.find("a");\n  [1].map(() => svc.find("b"));\n}\n',
        },
        "main.ts",
      ),
    ).toEqual([
      "u.find -> file:repo.ts/cls:Repo/fn:find",
      "svc.find -> file:repo.ts/cls:Repo/fn:find",
    ]);
  });

  it("lets a parameter of the same name hide the instance", () => {
    expect(
      fileCalls(
        {
          "repo.ts": repo,
          "main.ts":
            'import { Repo } from "./repo";\nconst u = new Repo();\nfunction run(u: Other) {\n  u.find("a");\n}\n',
        },
        "main.ts",
      ),
    ).toEqual([]);
  });

  it("resolves `this.m()` inherited from a class of another file, through two levels", () => {
    expect(
      fileCalls(
        {
          "base.ts":
            "export class Base {\n  log(msg: string) {\n    console.log(msg);\n  }\n}\n",
          "mid.ts":
            'import { Base } from "./base";\nexport class Mid extends Base {\n  ping() {}\n}\n',
          "user.ts":
            'import { Mid } from "./mid";\nexport class User extends Mid {\n  total() {\n    this.log("t");\n    this.ping();\n  }\n}\n',
        },
        "user.ts",
      ),
    ).toEqual([
      "log -> file:base.ts/cls:Base/fn:log",
      "ping -> file:mid.ts/cls:Mid/fn:ping",
    ]);
  });

  it("resolves a name of an `export * as ns` re-export", () => {
    expect(
      fileCalls(
        {
          "lib.ts": "export function beta() {}\n",
          "barrel.ts": 'export * as ns from "./lib";\n',
          "use.ts":
            'import { ns } from "./barrel";\nexport function useAll() {\n  ns.beta();\n}\n',
        },
        "use.ts",
      ),
    ).toEqual(["ns.beta -> file:lib.ts/fn:beta"]);
  });

  it("does not take `export * as ns` for a plain `export *`", () => {
    expect(
      fileCalls(
        {
          "lib.ts": "export function beta() {}\n",
          "barrel.ts": 'export * as ns from "./lib";\n',
          "use.ts":
            'import { beta } from "./barrel";\nexport function useAll() {\n  beta();\n}\n',
        },
        "use.ts",
      ),
    ).toEqual([]);
  });

  it("never makes a call into a workspace package external", () => {
    expect(
      fileCalls(
        {
          "core/package.json": '{ "name": "@acme/core" }',
          "core/src/index.ts": "export function coreFn() {}\n",
          "app/main.ts":
            'import { gone } from "@acme/core";\nexport function main() {\n  gone();\n}\n',
        },
        "app/main.ts",
      ),
    ).toEqual([]);
  });
});

describe("methods in a snippet", () => {
  const steps = (source: string) => calls(extract(source).nodes);

  it("resolves a static method and an instance method of a class of the text", () => {
    expect(
      steps(
        "class Repo {\n  find() {}\n  static create() {}\n}\nfunction run() {\n  Repo.create();\n  const r = new Repo();\n  r.find();\n}\n",
      ),
    ).toEqual([
      "Repo.create -> cls:Repo/fn:create",
      "r.find -> cls:Repo/fn:find",
    ]);
  });

  it("resolves a field set with `new` and a field typed with a generic", () => {
    expect(
      steps(
        "class Repo {\n  find() {}\n}\nclass S {\n  a = new Repo();\n  b: Repo<string>;\n  run() {\n    this.a.find();\n    this.b.find();\n  }\n}\n",
      ),
    ).toEqual([
      "this.a.find -> cls:Repo/fn:find",
      "this.b.find -> cls:Repo/fn:find",
    ]);
  });

  it("resolves `this.m()` inherited from a class of the text", () => {
    expect(
      steps(
        "class A {\n  log() {}\n}\nclass B extends A {\n  run() {\n    this.log();\n  }\n}\n",
      ),
    ).toEqual(["log -> cls:A/fn:log"]);
  });
});
