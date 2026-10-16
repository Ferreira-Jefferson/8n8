import { describe, expect, it } from "vitest";
import {
  expectWellFormed,
  extract,
  lines,
  node,
  outline,
  wires,
} from "./helpers";

/** Extracts `source` and checks it is well formed before the test reads it. */
function graphOf(source: string) {
  const graph = extract(source);
  expectWellFormed(graph, lines(source));
  return graph;
}

describe("functions", () => {
  it("maps a declaration, an async one and a generator", () => {
    const graph = graphOf(
      "function a() {}\nasync function b() {}\nfunction* c() {}\n",
    );

    expect(outline(graph)).toEqual([
      ["fn:a", "function", "a"],
      ["fn:b", "function", "b"],
      ["fn:c", "function", "c"],
    ]);
    expect(graph.nodes.every((n) => n.openable && n.parentId === null)).toBe(
      true,
    );
  });

  it("maps an arrow function and a function expression assigned to a const", () => {
    const graph = graphOf(
      "const a = (x: number) => { return x; };\nlet b = function () { return 1; };\nvar c = async () => 2;\n",
    );

    expect(outline(graph).filter(([, kind]) => kind === "function")).toEqual([
      ["fn:a", "function", "a"],
      ["fn:b", "function", "b"],
      ["fn:c", "function", "c"],
    ]);
  });

  it("keeps `export` in the range", () => {
    const graph = graphOf(
      "export function a() {}\nexport const b = () => 1;\n",
    );

    expect(node(graph, "fn:a").range).toEqual({ start: 1, end: 1 });
    expect(node(graph, "fn:b").range).toEqual({ start: 2, end: 2 });
  });

  it("names an anonymous default export `default`", () => {
    const graph = graphOf("export default function () { return 1; }\n");

    expect(outline(graph)[0]).toEqual(["fn:default", "function", "default"]);
  });

  it("maps a default export arrow and a named default function", () => {
    expect(outline(graphOf("export default () => 1;\n"))[0]).toEqual([
      "fn:default",
      "function",
      "default",
    ]);
    expect(outline(graphOf("export default function named() {}\n"))[0]).toEqual(
      ["fn:named", "function", "named"],
    );
  });

  it("leaves a const that holds a value, or several declarators, as loose code", () => {
    const graph = graphOf("const a = 1;\nconst f = () => 1, g = 2;\n");

    expect(outline(graph)).toEqual([
      ["mod", "module", "Módulo"],
      ["mod/s0", "code", "Código"],
    ]);
  });

  it("ignores a function signature and a declare", () => {
    const graph = graphOf("declare function d(): void;\nfunction f(): void;\n");

    expect(graph.empty).toBe(true);
  });

  it("makes an expression-bodied arrow function a single return", () => {
    const graph = graphOf(
      "const f = (x: number) => x + 1;\nconst g = () => h();\nfunction h() {}\n",
    );

    expect(outline(graph).filter(([id]) => id.startsWith("fn:f"))).toEqual([
      ["fn:f", "function", "f"],
      ["fn:f/s0", "return", "x + 1"],
    ]);
    expect(node(graph, "fn:g/s0").target).toBe("fn:h");
  });

  it("maps an arrow with a block body step by step", () => {
    const graph = graphOf(
      "const f = () => {\n  const a = 1;\n  return a;\n};\n",
    );

    expect(outline(graph)).toEqual([
      ["fn:f", "function", "f"],
      ["fn:f/s0", "code", "Código"],
      ["fn:f/s1", "return", "a"],
    ]);
  });

  it("does not make a step of a nested bare block", () => {
    const graph = graphOf("function f() {\n  {\n    x();\n  }\n}\n");

    expect(outline(graph)).toEqual([
      ["fn:f", "function", "f"],
      ["fn:f/s0", "external", "x"],
    ]);
  });
});

describe("classes", () => {
  const source = [
    "class Repo extends Base {",
    "  static limit = 10;",
    "  find(id: number) {",
    "    return this.log(id);",
    "  }",
    "  log = (x: number) => x;",
    "  get size() { return 1; }",
    "  set size(v: number) { this.n = v; }",
    "  constructor() { super(); }",
    "}",
    "export abstract class Shape { abstract name(): string; area() { return 0; } }",
    "export default class {}",
    "",
  ].join("\n");

  it("maps methods, fields that hold functions and loose fields", () => {
    const graph = graphOf(source);

    expect(outline(graph)).toEqual([
      ["cls:Repo", "class", "Repo"],
      ["cls:Repo/s0", "code", "Código"],
      ["cls:Repo/fn:find", "function", "find"],
      ["cls:Repo/fn:find/s0", "return", "this.log(id)"],
      ["cls:Repo/fn:log", "function", "log"],
      ["cls:Repo/fn:log/s0", "return", "x"],
      ["cls:Repo/fn:size", "function", "size"],
      ["cls:Repo/fn:size/s0", "return", "1"],
      ["cls:Repo/fn:size#2", "function", "size"],
      ["cls:Repo/fn:size#2/s0", "code", "Código"],
      ["cls:Repo/fn:constructor", "function", "constructor"],
      ["cls:Repo/fn:constructor/s0", "code", "Código"],
      ["cls:Shape", "class", "Shape"],
      ["cls:Shape/fn:area", "function", "area"],
      ["cls:Shape/fn:area/s0", "return", "0"],
      ["cls:default", "class", "default"],
    ]);
  });

  it("opens classes and methods, and parents the methods to the class", () => {
    const graph = graphOf(source);

    expect(node(graph, "cls:Repo").openable).toBe(true);
    expect(node(graph, "cls:Repo/fn:find").parentId).toBe("cls:Repo");
    expect(node(graph, "cls:Repo/s0").parentId).toBe("cls:Repo");
  });

  it("resolves `this.method()` to the method of the class", () => {
    const graph = graphOf(source);

    expect(node(graph, "cls:Repo/fn:find/s0").target).toBe("cls:Repo/fn:log");
    expect(wires(graph, "calls")).toContain(
      "cls:Repo/fn:find -> cls:Repo/fn:log",
    );
  });

  it("keeps a decorator of a method in its range", () => {
    const graph = graphOf(
      "class A {\n  @Get()\n  @Auth()\n  find() { return 1; }\n}\n",
    );

    expect(node(graph, "cls:A/fn:find").range).toEqual({ start: 2, end: 4 });
    expect(graph.nodes.every((n) => n.kind !== "code")).toBe(true);
  });

  it("keeps a decorator of a class in its range", () => {
    const graph = graphOf("@Injectable()\nexport class A {}\n");

    expect(node(graph, "cls:A").range).toEqual({ start: 1, end: 2 });
  });
});

describe("loose code and the module", () => {
  it("groups loose statements into one module, placed at the first of them", () => {
    const graph = graphOf(
      "const a = 1;\nfunction f() {}\nconst b = 2;\nclass C {}\nconst d = 3;\n",
    );

    expect(outline(graph)).toEqual([
      ["mod", "module", "Módulo"],
      ["mod/s0", "code", "Código"],
      ["fn:f", "function", "f"],
      ["cls:C", "class", "C"],
    ]);
    expect(node(graph, "mod").range).toEqual({ start: 1, end: 5 });
    expect(node(graph, "mod/s0").range).toEqual({ start: 1, end: 5 });
  });

  it("makes no module when there is only definitions", () => {
    const graph = graphOf("function f() {}\n");

    expect(graph.nodes.some((n) => n.kind === "module")).toBe(false);
  });

  it("splits loose code around a call", () => {
    const graph = graphOf(
      "const a = 1;\nconst b = go();\nconst c = 3;\nfunction go() {}\n",
    );

    expect(outline(graph).filter(([id]) => id.startsWith("mod"))).toEqual([
      ["mod", "module", "Módulo"],
      ["mod/s0", "code", "Código"],
      ["mod/s1", "call", "go"],
      ["mod/s2", "code", "Código"],
    ]);
  });

  it("ignores imports, re-exports, type declarations and require imports", () => {
    const graph = graphOf(
      [
        'import a from "a";',
        'import "side-effect";',
        'export { b } from "./b";',
        'export * from "./c";',
        "export { d };",
        "export interface I {}",
        "export type T = string;",
        "interface J {}",
        'const e = require("e");',
        'const { f, g: h } = require("f");',
        "",
      ].join("\n"),
    );

    expect(graph.empty).toBe(true);
  });

  it("keeps `export default value` and enums as loose code", () => {
    const graph = graphOf("export default foo;\nenum E { A }\n");

    expect(outline(graph)).toEqual([
      ["mod", "module", "Módulo"],
      ["mod/s0", "code", "Código"],
    ]);
  });

  it("calls resolved at the top level link the module to the function", () => {
    const graph = graphOf("run();\nfunction run() {}\n");

    expect(wires(graph, "calls")).toEqual(["mod -> fn:run"]);
  });
});

describe("conditions", () => {
  it("maps if with else: a branch `true` and a branch `false`", () => {
    const graph = graphOf(
      "function f(a) {\n  if (a > 1) {\n    x();\n  } else {\n    y();\n  }\n}\n",
    );

    expect(outline(graph)).toEqual([
      ["fn:f", "function", "f"],
      ["fn:f/s0", "condition", "a > 1"],
      ["fn:f/s0/b0/s0", "external", "x"],
      ["fn:f/s0/b1/s0", "external", "y"],
    ]);
    expect(node(graph, "fn:f/s0").openable).toBe(false);
    expect(wires(graph, "branch")).toEqual([
      "fn:f/s0 -> fn:f/s0/b0/s0 [true]",
      "fn:f/s0 -> fn:f/s0/b1/s0 [false]",
    ]);
  });

  it("flattens else if into branches of the same condition", () => {
    const graph = graphOf(
      "function f(a, b) {\n  if (a) { x(); } else if (b) { y(); } else { z(); }\n  w();\n}\n",
    );

    expect(wires(graph, "branch")).toEqual([
      "fn:f/s0 -> fn:f/s0/b0/s0 [true]",
      "fn:f/s0 -> fn:f/s0/b1/s0 [b]",
      "fn:f/s0 -> fn:f/s0/b2/s0 [false]",
    ]);
    expect(wires(graph, "next")).toEqual([
      "fn:f/s0/b0/s0 -> fn:f/s1",
      "fn:f/s0/b1/s0 -> fn:f/s1",
      "fn:f/s0/b2/s0 -> fn:f/s1",
    ]);
  });

  it("sends the missing else straight to the next step", () => {
    const graph = graphOf("function f(a) {\n  if (a) { x(); }\n  w();\n}\n");

    expect(wires(graph, "branch")).toEqual([
      "fn:f/s0 -> fn:f/s0/b0/s0 [true]",
      "fn:f/s0 -> fn:f/s1 [false]",
    ]);
  });

  it("takes a single statement as the body of a branch", () => {
    const graph = graphOf("function f(a) {\n  if (a) x(); else y();\n}\n");

    expect(outline(graph).map(([id]) => id)).toEqual([
      "fn:f",
      "fn:f/s0",
      "fn:f/s0/b0/s0",
      "fn:f/s0/b1/s0",
    ]);
  });

  it("joins a multi-line condition into one line", () => {
    const graph = graphOf(
      "function f(a, b) {\n  if (a &&\n      b) { x(); }\n}\n",
    );

    expect(node(graph, "fn:f/s0").label).toBe("a && b");
  });

  it("maps switch: one branch per case and the default", () => {
    const graph = graphOf(
      [
        "function f(m) {",
        "  switch (m) {",
        '    case "a":',
        '    case "b": {',
        "      x();",
        "      break;",
        "    }",
        "    default:",
        "      return y();",
        "  }",
        "  z();",
        "}",
        "",
      ].join("\n"),
    );

    expect(outline(graph)).toEqual([
      ["fn:f", "function", "f"],
      ["fn:f/s0", "condition", "m"],
      ["fn:f/s0/b1/s0", "external", "x"],
      ["fn:f/s0/b2/s0", "return", "y()"],
      ["fn:f/s1", "external", "z"],
    ]);
    expect(wires(graph, "branch")).toEqual([
      'fn:f/s0 -> fn:f/s0/b1/s0 ["b"]',
      "fn:f/s0 -> fn:f/s0/b2/s0 [padrão]",
      'fn:f/s0 -> fn:f/s1 ["a"]',
    ]);
  });

  it("sends a switch without default to the next step as `nenhum`", () => {
    const graph = graphOf(
      "function f(m) {\n  switch (m) {\n    case 1:\n      x();\n  }\n  z();\n}\n",
    );

    expect(wires(graph, "branch")).toEqual([
      "fn:f/s0 -> fn:f/s0/b0/s0 [1]",
      "fn:f/s0 -> fn:f/s1 [nenhum]",
    ]);
  });
});

describe("loops and blocks", () => {
  const cases: [string, string][] = [
    ["for (let i = 0; i < n; i++) { x(); }", "for (let i = 0; i < n; i++)"],
    ["for (const a of as) { x(); }", "for (const a of as)"],
    ["for (const k in obj) { x(); }", "for (const k in obj)"],
    ["for await (const a of as) { x(); }", "for await (const a of as)"],
    ["while (go) { x(); }", "while (go)"],
    ["do { x(); } while (go);", "do while (go)"],
  ];

  it.each(cases)(
    "maps `%s` as a loop that opens into its steps",
    (code, label) => {
      const graph = graphOf(`async function f() {\n  ${code}\n}\n`);

      expect(outline(graph)).toEqual([
        ["fn:f", "function", "f"],
        ["fn:f/s0", "loop", label],
        ["fn:f/s0/s0", "external", "x"],
      ]);
      expect(node(graph, "fn:f/s0").openable).toBe(true);
      expect(node(graph, "fn:f/s0/s0").parentId).toBe("fn:f/s0");
    },
  );

  it("takes a single statement as the body of a loop", () => {
    const graph = graphOf("function f() {\n  for (const a of as) x(a);\n}\n");

    expect(node(graph, "fn:f/s0/s0").kind).toBe("external");
  });

  it("joins a multi-line loop header into one line", () => {
    const graph = graphOf(
      "function f() {\n  for (const a of\n    as) { x(); }\n}\n",
    );

    expect(node(graph, "fn:f/s0").label).toBe("for (const a of as)");
  });

  it("maps return inside a loop and inside a branch, with no wire out", () => {
    const graph = graphOf(
      "function f(as) {\n  for (const a of as) {\n    if (a) { return a; }\n  }\n  return 0;\n}\n",
    );

    expect(outline(graph)).toEqual([
      ["fn:f", "function", "f"],
      ["fn:f/s0", "loop", "for (const a of as)"],
      ["fn:f/s0/s0", "condition", "a"],
      ["fn:f/s0/s0/b0/s0", "return", "a"],
      ["fn:f/s1", "return", "0"],
    ]);
    const leaving = graph.edges.filter(
      (e) => e.source === "fn:f/s0/s0/b0/s0" || e.source === "fn:f/s1",
    );
    expect(leaving).toEqual([]);
  });

  it("maps try as a block with the steps of try, catch and finally", () => {
    const graph = graphOf(
      "function f() {\n  try { a(); } catch (e) { b(); } finally { c(); }\n}\n",
    );

    expect(outline(graph)).toEqual([
      ["fn:f", "function", "f"],
      ["fn:f/s0", "block", "try"],
      ["fn:f/s0/s0", "external", "a"],
      ["fn:f/s0/s1", "external", "b"],
      ["fn:f/s0/s2", "external", "c"],
    ]);
    expect(node(graph, "fn:f/s0").openable).toBe(true);
  });

  it("maps a bare return, with an empty label", () => {
    const graph = graphOf("function f() {\n  return;\n}\n");

    expect(node(graph, "fn:f/s0")).toMatchObject({ kind: "return", label: "" });
  });

  it("gives a return the call it makes", () => {
    const graph = graphOf(
      "function f() {\n  return g();\n}\nfunction g() {}\nfunction h() {\n  return fetch('x');\n}\n",
    );

    expect(node(graph, "fn:f/s0").target).toBe("fn:g");
    expect(node(graph, "fn:h/s0")).toMatchObject({
      callee: "fetch",
      category: "HTTP",
    });
  });

  it("ignores break and continue", () => {
    const graph = graphOf(
      "function f() {\n  while (a) {\n    break;\n    continue;\n  }\n}\n",
    );

    expect(outline(graph).map(([id]) => id)).toEqual(["fn:f", "fn:f/s0"]);
  });
});
