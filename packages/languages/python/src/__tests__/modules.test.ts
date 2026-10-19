import { describe, expect, it } from "vitest";
import {
  buildModuleIndex,
  type ModuleIndex,
  moduleNameOf,
  packageOf,
  relativeBase,
  resolveName,
} from "../modules";
import { loadPythonParser } from "../parse";

/** Index of in-memory files given as `path → source`. */
async function indexOf(files: Record<string, string>): Promise<ModuleIndex> {
  const parser = await loadPythonParser();
  const parsed = Object.entries(files).map(([path, source]) => {
    const tree = parser.parse(source);
    if (!tree) throw new Error("parse failed");
    return { path, root: tree.rootNode };
  });
  return buildModuleIndex(parsed);
}

const FRETE = {
  "frete/__init__.py": "from .calculo import calcular_frete\n",
  "frete/calculo.py": "def calcular_frete(peso):\n    return peso\n",
};

describe("resolveName", () => {
  it("resolves a module path to its top-level def", async () => {
    const index = await indexOf(FRETE);

    expect(resolveName(index, "main.py", "frete.calculo.calcular_frete")).toBe(
      "file:frete/calculo.py/fn:calcular_frete",
    );
  });

  it("follows a re-export in __init__.py", async () => {
    const index = await indexOf(FRETE);

    expect(resolveName(index, "main.py", "frete.calcular_frete")).toBe(
      "file:frete/calculo.py/fn:calcular_frete",
    );
  });

  it("returns null on a re-export cycle", async () => {
    const index = await indexOf({
      "a/__init__.py": "from b import f\n",
      "b/__init__.py": "from a import f\n",
    });

    expect(resolveName(index, "main.py", "a.f")).toBeNull();
  });

  it("resolves relative names at level 1 and 2, and not above the root", async () => {
    const index = await indexOf({
      "a/b/c.py": "",
      "a/b/d.py": "def f():\n    pass\n",
      "a/e.py": "def g():\n    pass\n",
    });

    expect(resolveName(index, "a/b/c.py", ".d.f")).toBe("file:a/b/d.py/fn:f");
    expect(resolveName(index, "a/b/c.py", "..e.g")).toBe("file:a/e.py/fn:g");
    expect(resolveName(index, "a/b/c.py", "...e.g")).toBeNull();
  });

  it("falls back to the caller's folder", async () => {
    const index = await indexOf({
      "scripts/run.py": "import util\n",
      "scripts/util.py": "def f():\n    pass\n",
    });

    expect(resolveName(index, "scripts/run.py", "util.f")).toBe(
      "file:scripts/util.py/fn:f",
    );
  });

  it("prefers the root over the caller's folder", async () => {
    const index = await indexOf({
      "scripts/run.py": "import util\n",
      "scripts/util.py": "def f():\n    pass\n",
      "util.py": "def f():\n    pass\n",
    });

    expect(resolveName(index, "scripts/run.py", "util.f")).toBe(
      "file:util.py/fn:f",
    );
  });

  it("resolves a method of a class, also through a re-export, and leaves an unknown method unresolved", async () => {
    const index = await indexOf({
      "pkg/mod.py": "class Classe:\n    def metodo(self):\n        pass\n",
      "pkg/__init__.py": "from .mod import Classe\n",
    });

    expect(resolveName(index, "main.py", "pkg.mod.Classe.metodo")).toBe(
      "file:pkg/mod.py/cls:Classe/fn:metodo",
    );
    expect(resolveName(index, "main.py", "pkg.Classe.metodo")).toBe(
      "file:pkg/mod.py/cls:Classe/fn:metodo",
    );
    expect(resolveName(index, "main.py", "pkg.mod.Classe.outro")).toBeNull();
  });

  it("leaves a module outside the index unresolved", async () => {
    const index = await indexOf(FRETE);

    expect(resolveName(index, "main.py", "os.path.join")).toBeNull();
  });

  it("creates no alias for a star import", async () => {
    const index = await indexOf({
      ...FRETE,
      "m.py": "from frete.calculo import *\n",
    });

    expect(resolveName(index, "main.py", "m.calcular_frete")).toBeNull();
  });
});

describe("moduleNameOf", () => {
  it("joins the path segments with dots", () => {
    expect(moduleNameOf("a/b/c.py")).toBe("a.b.c");
  });

  it("names a package by its __init__.py folder", () => {
    expect(moduleNameOf("a/b/__init__.py")).toBe("a.b");
  });

  it("gives no name to the root __init__.py", () => {
    expect(moduleNameOf("__init__.py")).toBeNull();
  });

  it("names a root file by its stem", () => {
    expect(moduleNameOf("main.py")).toBe("main");
  });
});

describe("packageOf", () => {
  it("is the folder of a module", () => {
    expect(packageOf("a/b/c.py")).toBe("a.b");
  });

  it("is the package itself for an __init__.py", () => {
    expect(packageOf("a/b/__init__.py")).toBe("a.b");
  });

  it("is empty for a root file", () => {
    expect(packageOf("main.py")).toBe("");
  });
});

describe("relativeBase", () => {
  it("is the package at level 1", () => {
    expect(relativeBase("a/b/c.py", 1)).toBe("a.b");
  });

  it("goes up one package at level 2", () => {
    expect(relativeBase("a/b/c.py", 2)).toBe("a");
  });

  it("is null above the root", () => {
    expect(relativeBase("a/b/c.py", 3)).toBeNull();
  });

  it("is the package itself for an __init__.py at level 1", () => {
    expect(relativeBase("a/b/__init__.py", 1)).toBe("a.b");
  });
});
