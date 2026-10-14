import type { FlowNode, Graph } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { buildGraph } from "../build-graph";
import { loadPythonParser } from "../parse";
import { extractProject } from "../project";

async function graphOf(source: string): Promise<Graph> {
  const tree = (await loadPythonParser()).parse(source);
  if (!tree) throw new Error("parse failed");
  return buildGraph(tree);
}

function node(graph: Graph, id: string): FlowNode {
  const found = graph.nodes.find((n) => n.id === id);
  if (!found) throw new Error(`no node ${id}`);
  return found;
}

describe("docstring range", () => {
  it("marks the docstring of a function", async () => {
    const graph = await graphOf(
      'def f():\n    """Faz algo."""\n    return 1\n',
    );

    expect(node(graph, "fn:f").docstring).toEqual({ start: 2, end: 2 });
  });

  it("marks the docstring of a class, and of its method", async () => {
    const graph = await graphOf(
      'class C:\n    "Classe."\n\n    def m(self):\n        "Metodo."\n        pass\n',
    );

    expect(node(graph, "cls:C").docstring).toEqual({ start: 2, end: 2 });
    expect(node(graph, "cls:C/fn:m").docstring).toEqual({ start: 5, end: 5 });
  });

  it("marks the module docstring on the module node", async () => {
    const graph = await graphOf('"""Modulo."""\nx = 1\n\ndef f():\n    pass\n');

    expect(node(graph, "mod").docstring).toEqual({ start: 1, end: 1 });
    expect(node(graph, "fn:f")).not.toHaveProperty("docstring");
  });

  it("spans the real lines of a multi-line docstring", async () => {
    const graph = await graphOf(
      'def f():\n    """Linha um.\n\n    Linha tres.\n    """\n    return 1\n',
    );

    expect(node(graph, "fn:f").docstring).toEqual({ start: 2, end: 5 });
  });

  it("leaves the key out when there is no docstring", async () => {
    const graph = await graphOf("def f():\n    return 1\n\nx = 1\n");

    for (const n of graph.nodes) expect(n).not.toHaveProperty("docstring");
  });

  it("ignores a string that is not the first statement", async () => {
    const graph = await graphOf(
      'def f():\n    x = 1\n    "texto"\n    return x\n\nimport os\n"solto"\n',
    );

    for (const n of graph.nodes) expect(n).not.toHaveProperty("docstring");
  });

  it("works for ids prefixed with the file path in a project", async () => {
    const graph = await extractProject(await loadPythonParser(), [
      { path: "a.py", source: '"""Arquivo."""\n\ndef f():\n    """Doc."""\n' },
    ]);

    expect(node(graph, "file:a.py")).not.toHaveProperty("docstring");
    expect(node(graph, "file:a.py/mod").docstring).toEqual({
      start: 1,
      end: 1,
    });
    expect(node(graph, "file:a.py/fn:f").docstring).toEqual({
      start: 4,
      end: 4,
    });
  });
});
