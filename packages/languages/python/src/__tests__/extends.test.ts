import type { SourceFile } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { analyzeFiles } from "../analyze";
import { buildGraph } from "../build-graph";
import { loadPythonParser } from "../parse";

const parser = await loadPythonParser();

/** `source -> target` of every `extends` wire of a snippet. */
function snippet(source: string): string[] {
  const tree = parser.parse(source);
  if (!tree) throw new Error("parse failed");
  return buildGraph(tree)
    .edges.filter((e) => e.kind === "extends")
    .map((e) => `${e.source} -> ${e.target}`);
}

/** The same, over the files of a project. */
function project(files: Record<string, string>): string[] {
  const list = Object.entries(files).map(
    ([path, source]): SourceFile => ({ path, source }),
  );
  return analyzeFiles(parser, list).files.flatMap((f) =>
    f.graph.edges
      .filter((e) => e.kind === "extends")
      .map((e) => `${e.source} -> ${e.target}`),
  );
}

describe("extends: one file", () => {
  it("links a child class to its base", () => {
    expect(snippet("class A:\n    pass\n\nclass B(A):\n    pass\n")).toEqual([
      "cls:B -> cls:A",
    ]);
  });

  it("gives the id extends:<source>-><target>", () => {
    const tree = parser.parse("class A: ...\nclass B(A): ...\n");
    const edge =
      tree && buildGraph(tree).edges.find((e) => e.kind === "extends");

    expect(edge?.id).toBe("extends:cls:B->cls:A");
  });

  it("gives one wire per base in a multiple inheritance", () => {
    const source = "class A: ...\nclass C: ...\nclass B(A, C): ...\n";

    expect(snippet(source)).toEqual(["cls:B -> cls:A", "cls:B -> cls:C"]);
  });

  it("ignores a base from outside and a keyword argument", () => {
    const source =
      "class A(Exception): ...\nclass B(object, metaclass=Meta): ...\n";

    expect(snippet(source)).toEqual([]);
  });

  it("keeps the wire to the known base when another one is external", () => {
    expect(snippet("class A: ...\nclass B(A, Exception): ...\n")).toEqual([
      "cls:B -> cls:A",
    ]);
  });

  it("links a base that is defined after the child", () => {
    expect(snippet("class B(A): ...\nclass A: ...\n")).toEqual([
      "cls:B -> cls:A",
    ]);
  });

  it("ignores a class that inherits from itself", () => {
    expect(snippet("class A(A): ...\n")).toEqual([]);
  });

  it("ignores a base that is a function, and a nested class", () => {
    const source =
      "def A(): ...\nclass B(A): ...\nclass C:\n    class D(C): ...\n";

    expect(snippet(source)).toEqual([]);
  });

  it("does not repeat a pair", () => {
    expect(snippet("class A: ...\nclass B(A, A): ...\n")).toEqual([
      "cls:B -> cls:A",
    ]);
  });
});

describe("extends: project", () => {
  it("links to a class imported by name, with the file prefix on both ends", () => {
    expect(
      project({
        "base.py": "class A: ...\n",
        "main.py": "from base import A\n\nclass B(A): ...\n",
      }),
    ).toEqual(["file:main.py/cls:B -> file:base.py/cls:A"]);
  });

  it("links to a class read from a module (mod.A)", () => {
    expect(
      project({
        "pkg/base.py": "class A: ...\n",
        "main.py": "import pkg.base\n\nclass B(pkg.base.A): ...\n",
      }),
    ).toEqual(["file:main.py/cls:B -> file:pkg/base.py/cls:A"]);
  });

  it("ignores an imported name that is a function or from outside", () => {
    expect(
      project({
        "base.py": "def A(): ...\n",
        "main.py":
          "from base import A\nfrom lib import C\n\nclass B(A): ...\nclass D(C): ...\n",
      }),
    ).toEqual([]);
  });
});
