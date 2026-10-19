import type { FlowEdge, FlowNode, SourceFile } from "@8n8/model";
import { describe, expect, it } from "vitest";
import type { Parser } from "web-tree-sitter";
import { analyzeFiles } from "../analyze";
import { loadPythonParser } from "../parse";
import { lojaFiles } from "./loja";

const parser = await loadPythonParser();

/** The nodes and wires of the analysis, as the project joins them (without the folders). */
function projectOf(files: SourceFile[]): {
  nodes: FlowNode[];
  edges: FlowEdge[];
} {
  const analysis = analyzeFiles(parser, files);
  return {
    nodes: analysis.files.flatMap((f) => f.graph.nodes),
    edges: [
      ...analysis.files.flatMap((f) => f.graph.edges),
      ...analysis.imports,
    ],
  };
}

describe("analyzeFiles: files (PROJ-02)", () => {
  it("gives one graph per file, in code order, the file node first", () => {
    const analysis = analyzeFiles(parser, [...lojaFiles()].reverse());

    expect(analysis.files.map((f) => f.path)).toEqual(
      lojaFiles().map((f) => f.path),
    );
    expect(
      analysis.files.map((f) => [f.graph.nodes[0]?.id, f.graph.nodes[0]?.kind]),
    ).toEqual(lojaFiles().map((f) => [`file:${f.path}`, "file"]));
  });

  it("parents a file node on its folder, or on nothing in the root", () => {
    const { nodes } = projectOf(lojaFiles());
    const parent = (id: string) => nodes.find((n) => n.id === id)?.parentId;

    expect(parent("file:frete/calculo.py")).toBe("dir:frete");
    expect(parent("file:main.py")).toBeNull();
  });

  it("follows each file node with its inner nodes", () => {
    const { nodes } = projectOf(lojaFiles());
    const ids = nodes.map((n) => n.id);

    expect(ids[ids.indexOf("file:frete/calculo.py") + 1]).toBe(
      "file:frete/calculo.py/fn:calcular_frete",
    );
    const calc = nodes.find(
      (n) => n.id === "file:frete/calculo.py/fn:calcular_frete",
    );
    expect(calc?.parentId).toBe("file:frete/calculo.py");
  });

  it("spans a file node over all its lines", () => {
    const { nodes } = projectOf(lojaFiles());
    const byId = new Map(nodes.map((n) => [n.id, n]));

    expect(byId.get("file:frete/calculo.py")?.range).toEqual({
      start: 1,
      end: 4,
    });
    expect(byId.get("file:pedidos/pedidos.py")?.range).toEqual({
      start: 1,
      end: 8,
    });
  });

  it("throws with the file name when the parser gives no tree, so the project can isolate it", () => {
    const noTree = { parse: () => null } as unknown as Parser;

    expect(() =>
      analyzeFiles(noTree, [{ path: "a.py", source: "x = 1\n" }]),
    ).toThrow("tree-sitter could not parse a.py");
  });

  it("gives nothing for no files", () => {
    expect(analyzeFiles(parser, [])).toEqual({
      files: [],
      imports: [],
      offers: [],
      requests: [],
    });
  });
});

describe("analyzeFiles: calls between files (PROJ-04)", () => {
  it("resolves calcular_frete through the frete re-export", () => {
    const graph = projectOf(lojaFiles());
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

  it("wires main to processar_pedido", () => {
    const graph = projectOf(lojaFiles());

    expect(graph.edges).toContainEqual({
      id: "calls:file:main.py/fn:main->file:pedidos/pedidos.py/fn:processar_pedido",
      kind: "calls",
      source: "file:main.py/fn:main",
      target: "file:pedidos/pedidos.py/fn:processar_pedido",
    });
  });
});

describe("analyzeFiles: same name without an import (PROJ-09)", () => {
  it("makes the unimported calcular_frete in relatorio.py an EXTERNO step", () => {
    const graph = projectOf(lojaFiles());

    expect(
      graph.nodes
        .filter((n) => n.parentId === "file:relatorio.py/fn:gerar")
        .map((n) => [n.kind, n.callee, n.category]),
    ).toEqual([["return", "calcular_frete", "EXTERNO"]]);
  });

  it("never wires the legacy calcular_frete", () => {
    const graph = projectOf(lojaFiles());

    expect(
      graph.edges.filter(
        (e) => e.target === "file:legado/frete_antigo.py/fn:calcular_frete",
      ),
    ).toEqual([]);
  });
});

describe("analyzeFiles: determinism and edge cases", () => {
  it("gives the same graph on two runs and with the files reversed", () => {
    const first = projectOf(lojaFiles());

    expect(projectOf(lojaFiles())).toEqual(first);
    expect(projectOf(lojaFiles().reverse())).toEqual(first);
  });

  it("marks a syntax error only on the nodes of its file, and on its file node", () => {
    const graph = projectOf([
      { path: "a.py", source: "def f():\n    x = 1\n" },
      { path: "b.py", source: "def g():\n    x = (1 +\n" },
    ]);

    expect(
      graph.nodes
        .filter((n) => n.syntaxError !== undefined)
        .map((n) => [n.id, n.syntaxError]),
    ).toEqual([
      ["file:b.py", { line: 2 }],
      ["file:b.py/fn:g", { line: 2 }],
    ]);
  });

  it("warns the file node of the first error inside its nodes", () => {
    const graph = projectOf([
      {
        path: "broken.py",
        source:
          "def ok():\n    return 1\n\ndef bad(:\n    return 2\n\ndef after():\n    return ok(\n",
      },
    ]);
    const marks = new Map(graph.nodes.map((n) => [n.id, n.syntaxError]));

    expect(marks.get("file:broken.py")).toEqual({ line: 4 });
    expect(marks.get("file:broken.py/fn:bad")).toEqual({ line: 4 });
    expect(marks.get("file:broken.py/fn:ok")).toBeUndefined();
  });

  it("marks the file node when the error sits outside its inner nodes", () => {
    const graph = projectOf([{ path: "b.py", source: "import (\n" }]);

    expect(graph.nodes.map((n) => [n.id, n.syntaxError ?? null])).toEqual([
      ["file:b.py", { line: 1 }],
    ]);
  });
});

function importIds(graph: { edges: FlowEdge[] }): string[] {
  return graph.edges
    .filter((e) => e.kind === "imports")
    .map((e) => e.id)
    .sort();
}

describe("analyzeFiles: imports wires (PROJ-03)", () => {
  it("wires exactly the four imports of the fixture", () => {
    const graph = projectOf(lojaFiles());

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

  it("wires from a import b to the submodule a/b.py", () => {
    const graph = projectOf([
      { path: "a/__init__.py", source: "" },
      { path: "a/b.py", source: "def f():\n    pass\n" },
      { path: "m.py", source: "from a import b\n" },
    ]);

    expect(importIds(graph)).toEqual(["imports:file:m.py->file:a/b.py"]);
  });

  it("wires from a import b to a/__init__.py when b is not a submodule", () => {
    const graph = projectOf([
      { path: "a/__init__.py", source: "def b():\n    pass\n" },
      { path: "m.py", source: "from a import b\n" },
    ]);

    expect(importIds(graph)).toEqual(["imports:file:m.py->file:a/__init__.py"]);
  });

  it("wires nothing for a module outside the root or the file itself", () => {
    const graph = projectOf([
      { path: "m.py", source: "import os\nimport m\n" },
    ]);

    expect(importIds(graph)).toEqual([]);
  });

  it("wires two imports of the same file once", () => {
    const graph = projectOf([
      { path: "a/__init__.py", source: "" },
      { path: "a/b.py", source: "def f():\n    pass\n" },
      { path: "m.py", source: "import a.b\nfrom a.b import f\n" },
    ]);

    expect(importIds(graph)).toEqual(["imports:file:m.py->file:a/b.py"]);
  });

  it("wires from . import b to the sibling b.py of the package", () => {
    const graph = projectOf([
      { path: "pedidos/__init__.py", source: "" },
      { path: "pedidos/a.py", source: "from . import b\n" },
      { path: "pedidos/b.py", source: "def f():\n    pass\n" },
    ]);

    expect(importIds(graph)).toEqual([
      "imports:file:pedidos/a.py->file:pedidos/b.py",
    ]);
  });

  it("wires a script-style import b through the caller's folder", () => {
    const graph = projectOf([
      { path: "scripts/a.py", source: "import b\n" },
      { path: "scripts/b.py", source: "def f():\n    pass\n" },
    ]);

    expect(importIds(graph)).toEqual([
      "imports:file:scripts/a.py->file:scripts/b.py",
    ]);
  });
});
