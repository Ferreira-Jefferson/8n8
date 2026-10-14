import type { Graph, SourceFile } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { loadPythonParser } from "../parse";
import { extractProject } from "../project";
import { lojaFiles } from "./loja";

async function projectOf(files: SourceFile[]): Promise<Graph> {
  return extractProject(await loadPythonParser(), files);
}

const STRUCTURE = new Set(["folder", "file"]);

describe("extractProject: folders and files (PROJ-02)", () => {
  it("lays out folder and file nodes in pre-order, folders before files", async () => {
    const graph = await projectOf(lojaFiles());

    expect(
      graph.nodes
        .filter((n) => STRUCTURE.has(n.kind))
        .map((n) => [n.id, n.kind, n.label, n.path, n.parentId]),
    ).toEqual([
      ["dir:.", "folder", "raiz", "", null],
      ["file:main.py", "file", "main.py", "main.py", "dir:."],
      ["file:relatorio.py", "file", "relatorio.py", "relatorio.py", "dir:."],
      ["dir:frete", "folder", "frete", "frete", null],
      [
        "file:frete/__init__.py",
        "file",
        "__init__.py",
        "frete/__init__.py",
        "dir:frete",
      ],
      [
        "file:frete/calculo.py",
        "file",
        "calculo.py",
        "frete/calculo.py",
        "dir:frete",
      ],
      ["dir:legado", "folder", "legado", "legado", null],
      [
        "file:legado/frete_antigo.py",
        "file",
        "frete_antigo.py",
        "legado/frete_antigo.py",
        "dir:legado",
      ],
      ["dir:pedidos", "folder", "pedidos", "pedidos", null],
      [
        "file:pedidos/__init__.py",
        "file",
        "__init__.py",
        "pedidos/__init__.py",
        "dir:pedidos",
      ],
      [
        "file:pedidos/itens.py",
        "file",
        "itens.py",
        "pedidos/itens.py",
        "dir:pedidos",
      ],
      [
        "file:pedidos/pedidos.py",
        "file",
        "pedidos.py",
        "pedidos/pedidos.py",
        "dir:pedidos",
      ],
    ]);
  });

  it("follows each file node with its inner nodes", async () => {
    const graph = await projectOf(lojaFiles());
    const ids = graph.nodes.map((n) => n.id);

    expect(ids[ids.indexOf("file:frete/calculo.py") + 1]).toBe(
      "file:frete/calculo.py/fn:calcular_frete",
    );
    const calc = graph.nodes.find(
      (n) => n.id === "file:frete/calculo.py/fn:calcular_frete",
    );
    expect(calc?.parentId).toBe("file:frete/calculo.py");
  });

  it("spans a file node over all its lines and a folder node over {1, 1}", async () => {
    const graph = await projectOf(lojaFiles());
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));

    expect(byId.get("file:frete/calculo.py")?.range).toEqual({
      start: 1,
      end: 4,
    });
    expect(byId.get("file:pedidos/pedidos.py")?.range).toEqual({
      start: 1,
      end: 8,
    });
    expect(byId.get("dir:frete")?.range).toEqual({ start: 1, end: 1 });
  });

  it("leaves out the root node when no file sits at the root", async () => {
    const graph = await projectOf([
      { path: "a/b.py", source: "def f():\n    pass\n" },
    ]);

    expect(
      graph.nodes.filter((n) => STRUCTURE.has(n.kind)).map((n) => n.id),
    ).toEqual(["dir:a", "file:a/b.py"]);
  });
});

describe("extractProject: calls between files (PROJ-04)", () => {
  it("resolves calcular_frete through the frete re-export", async () => {
    const graph = await projectOf(lojaFiles());
    const caller = "file:pedidos/pedidos.py/fn:processar_pedido";
    const target = "file:frete/calculo.py/fn:calcular_frete";

    expect(
      graph.nodes.filter(
        (n) =>
          n.parentId === caller && n.kind === "call" && n.target === target,
      ),
    ).toMatchObject([{ label: "calcular_frete" }]);
    expect(graph.edges).toContainEqual({
      id: `calls:${caller}->${target}`,
      kind: "calls",
      source: caller,
      target,
    });
  });

  it("wires main to processar_pedido", async () => {
    const graph = await projectOf(lojaFiles());

    expect(graph.edges).toContainEqual({
      id: "calls:file:main.py/fn:main->file:pedidos/pedidos.py/fn:processar_pedido",
      kind: "calls",
      source: "file:main.py/fn:main",
      target: "file:pedidos/pedidos.py/fn:processar_pedido",
    });
  });
});

describe("extractProject: same name without an import (PROJ-09)", () => {
  it("makes the unimported calcular_frete in relatorio.py an EXTERNO step", async () => {
    const graph = await projectOf(lojaFiles());

    expect(
      graph.nodes
        .filter((n) => n.parentId === "file:relatorio.py/fn:gerar")
        .map((n) => [n.kind, n.callee, n.category]),
    ).toEqual([["return", "calcular_frete", "EXTERNO"]]);
  });

  it("never wires the legacy calcular_frete", async () => {
    const graph = await projectOf(lojaFiles());

    expect(
      graph.edges.filter(
        (e) => e.target === "file:legado/frete_antigo.py/fn:calcular_frete",
      ),
    ).toEqual([]);
  });
});

describe("extractProject: determinism and edge cases", () => {
  it("gives the same graph on two runs and with the files reversed", async () => {
    const first = await projectOf(lojaFiles());

    expect(await projectOf(lojaFiles())).toEqual(first);
    expect(await projectOf(lojaFiles().reverse())).toEqual(first);
  });

  it("marks a syntax error only on the nodes of its file", async () => {
    const graph = await projectOf([
      { path: "a.py", source: "def f():\n    x = 1\n" },
      { path: "b.py", source: "def g():\n    x = (1 +\n" },
    ]);

    expect(
      graph.nodes
        .filter((n) => n.syntaxError !== undefined)
        .map((n) => [n.id, n.syntaxError]),
    ).toEqual([["file:b.py/fn:g", { line: 2 }]]);
  });

  it("marks the file node when the error sits outside its inner nodes", async () => {
    const graph = await projectOf([{ path: "b.py", source: "import (\n" }]);

    expect(graph.nodes.map((n) => [n.id, n.syntaxError ?? null])).toEqual([
      ["dir:.", null],
      ["file:b.py", { line: 1 }],
    ]);
  });

  it("gives an empty graph for no files", async () => {
    expect(await projectOf([])).toEqual({
      language: "python",
      empty: true,
      nodes: [],
      edges: [],
    });
  });

  it("throws on a repeated node id", async () => {
    const parser = await loadPythonParser();

    expect(() =>
      extractProject(parser, [
        { path: "a.py", source: "def y():\n    pass\n" },
        { path: "a.py/fn:y", source: "" },
      ]),
    ).toThrow(/file:a\.py\/fn:y/);
  });
});

function importIds(graph: Graph): string[] {
  return graph.edges
    .filter((e) => e.kind === "imports")
    .map((e) => e.id)
    .sort();
}

describe("extractProject: imports wires (PROJ-03)", () => {
  it("wires exactly the four imports of the fixture", async () => {
    const graph = await projectOf(lojaFiles());

    expect(importIds(graph)).toEqual(
      [
        "imports:file:main.py->file:pedidos/pedidos.py",
        "imports:file:pedidos/pedidos.py->file:frete/__init__.py",
        "imports:file:pedidos/pedidos.py->file:pedidos/itens.py",
        "imports:file:frete/__init__.py->file:frete/calculo.py",
      ].sort(),
    );
    expect(graph.edges).toContainEqual({
      id: "imports:file:main.py->file:pedidos/pedidos.py",
      kind: "imports",
      source: "file:main.py",
      target: "file:pedidos/pedidos.py",
    });
  });

  it("wires from a import b to the submodule a/b.py", async () => {
    const graph = await projectOf([
      { path: "a/__init__.py", source: "" },
      { path: "a/b.py", source: "def f():\n    pass\n" },
      { path: "m.py", source: "from a import b\n" },
    ]);

    expect(importIds(graph)).toEqual(["imports:file:m.py->file:a/b.py"]);
  });

  it("wires from a import b to a/__init__.py when b is not a submodule", async () => {
    const graph = await projectOf([
      { path: "a/__init__.py", source: "def b():\n    pass\n" },
      { path: "m.py", source: "from a import b\n" },
    ]);

    expect(importIds(graph)).toEqual(["imports:file:m.py->file:a/__init__.py"]);
  });

  it("wires nothing for a module outside the root or the file itself", async () => {
    const graph = await projectOf([
      { path: "m.py", source: "import os\nimport m\n" },
    ]);

    expect(importIds(graph)).toEqual([]);
  });

  it("wires two imports of the same file once", async () => {
    const graph = await projectOf([
      { path: "a/__init__.py", source: "" },
      { path: "a/b.py", source: "def f():\n    pass\n" },
      { path: "m.py", source: "import a.b\nfrom a.b import f\n" },
    ]);

    expect(importIds(graph)).toEqual(["imports:file:m.py->file:a/b.py"]);
  });

  it("wires from . import b to the sibling b.py of the package", async () => {
    const graph = await projectOf([
      { path: "pedidos/__init__.py", source: "" },
      { path: "pedidos/a.py", source: "from . import b\n" },
      { path: "pedidos/b.py", source: "def f():\n    pass\n" },
    ]);

    expect(importIds(graph)).toEqual([
      "imports:file:pedidos/a.py->file:pedidos/b.py",
    ]);
  });

  it("wires a script-style import b through the caller's folder", async () => {
    const graph = await projectOf([
      { path: "scripts/a.py", source: "import b\n" },
      { path: "scripts/b.py", source: "def f():\n    pass\n" },
    ]);

    expect(importIds(graph)).toEqual([
      "imports:file:scripts/a.py->file:scripts/b.py",
    ]);
  });
});
