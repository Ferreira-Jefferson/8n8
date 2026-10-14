import { describe, expect, it } from "vitest";
import { boundNames } from "../bound";
import { loadPythonParser } from "../parse";

async function boundIn(source: string): Promise<Set<string>> {
  const parser = await loadPythonParser();
  const tree = parser.parse(source);
  if (!tree) throw new Error("parse failed");
  return boundNames(tree.rootNode);
}

describe("boundNames: parameters", () => {
  it("binds a plain parameter", async () => {
    expect(await boundIn("def f(a):\n    pass\n")).toContain("a");
  });

  it("binds a parameter with a default", async () => {
    expect(await boundIn("def f(a=1):\n    pass\n")).toContain("a");
  });

  it("binds a parameter with a type, with and without a default", async () => {
    const names = await boundIn("def f(a: int, b: str = 'x'):\n    pass\n");
    expect(names).toContain("a");
    expect(names).toContain("b");
  });

  it("binds *args", async () => {
    expect(await boundIn("def f(*args):\n    pass\n")).toContain("args");
  });

  it("binds **kw", async () => {
    expect(await boundIn("def f(**kw):\n    pass\n")).toContain("kw");
  });

  it("binds the parameters of a lambda", async () => {
    const names = await boundIn("g = lambda x, y=2: x + y\n");
    expect(names).toContain("x");
    expect(names).toContain("y");
  });
});

describe("boundNames: assignment targets", () => {
  it("binds the target of a plain =", async () => {
    expect(await boundIn("r = f()\n")).toContain("r");
  });

  it("binds the names inside a tuple and a list target", async () => {
    const names = await boundIn("a, (b, c) = x\n[d, *e] = y\n");
    expect([...names].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("binds the target of +=", async () => {
    expect(await boundIn("total += 1\n")).toContain("total");
  });

  it("binds the target of an annotation, with and without a value", async () => {
    const names = await boundIn("a: int = 1\nb: str\n");
    expect(names).toContain("a");
    expect(names).toContain("b");
  });

  it("does not bind the object of an attribute or subscript target", async () => {
    expect(await boundIn("obj.x = 1\nd[k] = 2\n")).toEqual(new Set());
  });
});

describe("boundNames: loops, with, except, import, :=", () => {
  it("binds the targets of a for", async () => {
    const names = await boundIn("for i, item in pares:\n    pass\n");
    expect(names).toContain("i");
    expect(names).toContain("item");
  });

  it("binds the target of a for in a comprehension", async () => {
    expect(await boundIn("p = sum(i for i in itens)\n")).toContain("i");
  });

  it("binds the name after as in a with", async () => {
    expect(await boundIn("with open(p) as fh:\n    pass\n")).toContain("fh");
  });

  it("binds the name after as in an except", async () => {
    const source = "try:\n    pass\nexcept ValueError as err:\n    pass\n";
    const names = await boundIn(source);
    expect(names).toContain("err");
    expect(names).not.toContain("ValueError");
  });

  it("binds the name after as in an import", async () => {
    const names = await boundIn("import numpy as np\nfrom m import n as nn\n");
    expect(names).toContain("np");
    expect(names).toContain("nn");
  });

  it("binds the name of :=", async () => {
    expect(await boundIn("if (n := len(x)) > 3:\n    pass\n")).toContain("n");
  });
});

describe("boundNames: definitions and declarations", () => {
  it("binds the name of a def", async () => {
    expect(await boundIn("def salvar():\n    pass\n")).toContain("salvar");
  });

  it("binds the name of a class", async () => {
    expect(await boundIn("class Pedido:\n    pass\n")).toContain("Pedido");
  });

  it("binds the names of global", async () => {
    const names = await boundIn("def f():\n    global db, conn\n");
    expect(names).toContain("db");
    expect(names).toContain("conn");
  });

  it("binds the names of nonlocal", async () => {
    const source = "def f():\n    x = 1\n    def g():\n        nonlocal y\n";
    expect(await boundIn(source)).toContain("y");
  });
});

describe("boundNames: what does not count and the scope", () => {
  it("leaves out a name that is only used", async () => {
    expect(await boundIn("print(x)\n")).toEqual(new Set());
  });

  it("counts a name bound inside a function in the whole file", async () => {
    const source = "def f():\n    cursor = abrir()\n\ncursor.execute(q)\n";
    const names = await boundIn(source);
    expect(names).toContain("cursor");
    expect([...names].sort()).toEqual(["cursor", "f"]);
  });
});
