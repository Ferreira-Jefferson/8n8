import { readFileSync } from "node:fs";
import type { FlowNode, Graph } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { buildGraph } from "../build-graph";
import { loadPythonParser } from "../parse";

const videoFixture = readFileSync(
  new URL("./fixtures/pedido_frete.py", import.meta.url),
  "utf8",
);

async function graphOf(source: string): Promise<Graph> {
  const parser = await loadPythonParser();
  const tree = parser.parse(source);
  if (!tree) throw new Error("parse failed");
  return buildGraph(tree);
}

const STRUCTURAL = new Set(["module", "function", "class"]);

/** Top-level nodes, methods and the module: everything that is not a step. */
function structural(graph: Graph): FlowNode[] {
  return graph.nodes.filter((n) => STRUCTURAL.has(n.kind));
}

function byId(graph: Graph, id: string): FlowNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

/** True when every node comes right after its ancestors' subtrees open. */
function isPreOrder(nodes: FlowNode[]): boolean {
  const open: string[] = [];
  for (const node of nodes) {
    while (open.length > 0 && open[open.length - 1] !== node.parentId) {
      open.pop();
    }
    if (node.parentId !== null && open.length === 0) return false;
    open.push(node.id);
  }
  return true;
}

describe("buildGraph: top level", () => {
  it("creates exactly the two functions of the video fixture, without a module for the import", async () => {
    const graph = await graphOf(videoFixture);

    expect(graph.nodes.filter((n) => n.parentId === null)).toEqual([
      {
        id: "fn:calcular_frete",
        kind: "function",
        label: "calcular_frete",
        parentId: null,
        range: { start: 4, end: 11 },
        openable: true,
      },
      {
        id: "fn:processar_pedido",
        kind: "function",
        label: "processar_pedido",
        parentId: null,
        range: { start: 14, end: 18 },
        openable: true,
      },
    ]);
    expect(graph.empty).toBe(false);
    expect(graph.language).toBe("python");
  });

  it("creates no module node when the snippet has only functions", async () => {
    const graph = await graphOf("def a():\n    pass\n\ndef b():\n    pass\n");

    expect(graph.nodes.some((n) => n.kind === "module")).toBe(false);
    expect(structural(graph).map((n) => n.id)).toEqual(["fn:a", "fn:b"]);
  });

  it("groups a loose statement into the module node labeled Módulo (CORE-03)", async () => {
    const graph = await graphOf("x = 1\n");

    expect(byId(graph, "mod")).toEqual({
      id: "mod",
      kind: "module",
      label: "Módulo",
      parentId: null,
      range: { start: 1, end: 1 },
      openable: true,
    });
  });

  it("makes methods children of their class", async () => {
    const graph = await graphOf(
      "class Pedido:\n    def validar(self):\n        pass\n",
    );

    expect(structural(graph)).toEqual([
      {
        id: "cls:Pedido",
        kind: "class",
        label: "Pedido",
        parentId: null,
        range: { start: 1, end: 3 },
        openable: true,
      },
      {
        id: "cls:Pedido/fn:validar",
        kind: "function",
        label: "validar",
        parentId: "cls:Pedido",
        range: { start: 2, end: 3 },
        openable: true,
      },
    ]);
  });

  it("suffixes a repeated name with #2 in code order", async () => {
    const graph = await graphOf(
      "def f():\n    return 1\n\ndef f():\n    return 2\n",
    );

    const fns = structural(graph);
    expect(fns.map((n) => n.id)).toEqual(["fn:f", "fn:f#2"]);
    expect(fns.map((n) => n.range.start)).toEqual([1, 4]);
  });

  it("marks an empty snippet as empty with no nodes (CORE-07)", async () => {
    const graph = await graphOf("");

    expect(graph.empty).toBe(true);
    expect(graph.nodes).toEqual([]);
  });

  it("marks a comments-only snippet as empty with no nodes (CORE-07)", async () => {
    const graph = await graphOf("# só um comentário\n# e outro\n");

    expect(graph.empty).toBe(true);
    expect(graph.nodes).toEqual([]);
  });

  it("emits nodes in pre-order, following the code order", async () => {
    const source = [
      "def a():",
      "    pass",
      "x = 1",
      "class B:",
      "    def m(self):",
      "        pass",
      "def c():",
      "    pass",
    ].join("\n");
    const graph = await graphOf(source);

    expect(structural(graph).map((n) => n.id)).toEqual([
      "fn:a",
      "mod",
      "cls:B",
      "cls:B/fn:m",
      "fn:c",
    ]);
    expect(isPreOrder(graph.nodes)).toBe(true);
  });
});
