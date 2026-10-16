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

describe("extends, rare shapes: one file", () => {
  it("links a decorated class", () => {
    expect(snippet("class A: ...\n\n@dataclass\nclass B(A): ...\n")).toEqual([
      "cls:B -> cls:A",
    ]);
  });

  it("links a base followed by a trailing comma", () => {
    expect(snippet("class A: ...\nclass B(A,): ...\n")).toEqual([
      "cls:B -> cls:A",
    ]);
  });

  it("draws nothing for a class with empty parentheses or none", () => {
    expect(snippet("class A(): ...\nclass B: ...\n")).toEqual([]);
  });

  it("links a chain of three, one wire per step", () => {
    const source = "class A: ...\nclass B(A): ...\nclass C(B): ...\n";

    expect(snippet(source)).toEqual(["cls:B -> cls:A", "cls:C -> cls:B"]);
  });

  it("links the class defined last when a name is defined twice", () => {
    const source = "class A: ...\nclass A: ...\nclass B(A): ...\n";

    expect(snippet(source)).toEqual(["cls:B -> cls:A#2"]);
  });

  it("ignores a base that is a call, and keeps a known base next to a generic", () => {
    const source =
      "class A: ...\nclass B(make_base()): ...\nclass C(Generic[T], A): ...\n";

    expect(snippet(source)).toEqual(["cls:C -> cls:A"]);
  });

  it("ignores a class under an if, which is no top-level class", () => {
    const source = "class A: ...\nif X:\n    class B(A): ...\n";

    expect(snippet(source)).toEqual([]);
  });

  it("draws both wires of two classes that inherit from each other, without looping", () => {
    const source = "class A(B): ...\nclass B(A): ...\n";

    expect(snippet(source).sort()).toEqual([
      "cls:A -> cls:B",
      "cls:B -> cls:A",
    ]);
  });

  it("ignores an unresolved dotted base", () => {
    expect(snippet("class B(a.b.c.D): ...\n")).toEqual([]);
  });

  it("handles 300 classes in one chain", () => {
    const lines = ["class C0: ..."];
    for (let i = 1; i < 300; i++) lines.push(`class C${i}(C${i - 1}): ...`);

    expect(snippet(lines.join("\n"))).toHaveLength(299);
  });
});

describe("extends, rare shapes: project", () => {
  it("links a base imported under another name", () => {
    expect(
      project({
        "base.py": "class A: ...\n",
        "main.py": "from base import A as Base\n\nclass B(Base): ...\n",
      }),
    ).toEqual(["file:main.py/cls:B -> file:base.py/cls:A"]);
  });

  it("links a base from a relative import", () => {
    expect(
      project({
        "pkg/__init__.py": "",
        "pkg/base.py": "class A: ...\n",
        "pkg/main.py": "from .base import A\n\nclass B(A): ...\n",
      }),
    ).toEqual(["file:pkg/main.py/cls:B -> file:pkg/base.py/cls:A"]);
  });

  it("links through a circular import, once", () => {
    expect(
      project({
        "base.py": "from main import B\n\nclass A: ...\n",
        "main.py": "from base import A\n\nclass B(A): ...\n",
      }),
    ).toEqual(["file:main.py/cls:B -> file:base.py/cls:A"]);
  });

  it("links a chain that crosses three files", () => {
    expect(
      project({
        "a.py": "class A: ...\n",
        "b.py": "from a import A\n\nclass B(A): ...\n",
        "c.py": "from b import B\n\nclass C(B): ...\n",
      }).sort(),
    ).toEqual([
      "file:b.py/cls:B -> file:a.py/cls:A",
      "file:c.py/cls:C -> file:b.py/cls:B",
    ]);
  });

  it("draws nothing for an empty file or a file with only a syntax error", () => {
    expect(project({ "a.py": "", "b.py": "class (:\n" })).toEqual([]);
  });
});
