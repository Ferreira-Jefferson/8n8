import type { FlowNode, Graph } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { buildGraph } from "../build-graph";
import { loadPythonParser } from "../parse";

async function graphOf(source: string): Promise<Graph> {
  const parser = await loadPythonParser();
  const tree = parser.parse(source);
  if (!tree) throw new Error("parse failed");
  return buildGraph(tree);
}

function lines(...rows: string[]): string {
  return `${rows.join("\n")}\n`;
}

/** Direct steps of `parentId`, in emitted order. */
function stepsOf(graph: Graph, parentId: string): FlowNode[] {
  return graph.nodes.filter((n) => n.parentId === parentId);
}

function edgeIds(graph: Graph, kind: string): string[] {
  return graph.edges.filter((e) => e.kind === kind).map((e) => e.id);
}

describe("buildSteps: linear steps", () => {
  it("emits the steps of a function in code order with s<i> ids and next wires (CORE-08)", async () => {
    const graph = await graphOf(
      lines(
        "import requests",
        "def x():",
        "    a = 1",
        "    requests.get(u)",
        "    b = 2",
      ),
    );

    expect(stepsOf(graph, "fn:x").map((n) => [n.id, n.kind])).toEqual([
      ["fn:x/s0", "code"],
      ["fn:x/s1", "external"],
      ["fn:x/s2", "code"],
    ]);
    expect(edgeIds(graph, "next")).toEqual([
      "next:fn:x/s0->fn:x/s1",
      "next:fn:x/s1->fn:x/s2",
    ]);
  });

  it("groups three call-free assignments into one Código node with their line range (CORE-13)", async () => {
    const graph = await graphOf(
      lines("def x():", "    a = 1", "    b = a + 1", "    c = b * 2"),
    );

    expect(stepsOf(graph, "fn:x")).toEqual([
      {
        id: "fn:x/s0",
        kind: "code",
        label: "Código",
        parentId: "fn:x",
        range: { start: 2, end: 4 },
        openable: false,
      },
    ]);
  });

  it("puts a call-free return into the preceding code group", async () => {
    const graph = await graphOf(
      lines("def x():", "    a = 1", "    b = 2", "    return a + b"),
    );

    const steps = stepsOf(graph, "fn:x");
    expect(steps.map((n) => [n.kind, n.range])).toEqual([
      ["code", { start: 2, end: 4 }],
    ]);
  });

  it("turns a call to a snippet function into a call step with target (CORE-11)", async () => {
    const graph = await graphOf(
      lines(
        "def calcular_frete(p):",
        "    return p",
        "def x(p):",
        "    y = calcular_frete(p)",
      ),
    );

    expect(stepsOf(graph, "fn:x")).toEqual([
      {
        id: "fn:x/s0",
        kind: "call",
        label: "calcular_frete",
        parentId: "fn:x",
        range: { start: 4, end: 4 },
        openable: true,
        target: "fn:calcular_frete",
      },
    ]);
  });

  it("turns an external library call into an external step with category (CORE-12)", async () => {
    const graph = await graphOf(
      lines("import requests", "def x(url):", "    resp = requests.get(url)"),
    );

    expect(stepsOf(graph, "fn:x")).toEqual([
      {
        id: "fn:x/s0",
        kind: "external",
        label: "requests.get",
        parentId: "fn:x",
        range: { start: 3, end: 3 },
        openable: false,
        callee: "requests.get",
        category: "HTTP",
      },
    ]);
  });

  it("splits a code group around a call into code, call, code", async () => {
    const graph = await graphOf(
      lines(
        "def f():",
        "    return 1",
        "def x():",
        "    a = 1",
        "    b = 2",
        "    c = f()",
        "    d = c",
        "    e = d",
      ),
    );

    expect(stepsOf(graph, "fn:x").map((n) => [n.id, n.kind, n.range])).toEqual([
      ["fn:x/s0", "code", { start: 4, end: 5 }],
      ["fn:x/s1", "call", { start: 6, end: 6 }],
      ["fn:x/s2", "code", { start: 7, end: 8 }],
    ]);
  });

  it("builds module steps from loose statements; an import is neither a step nor a module", async () => {
    const withLoose = await graphOf(lines("import requests", "x = 1", "y = 2"));
    expect(
      stepsOf(withLoose, "mod").map((n) => [n.id, n.kind, n.range]),
    ).toEqual([["mod/s0", "code", { start: 2, end: 3 }]]);

    const onlyImport = await graphOf(lines("import requests", "import os"));
    expect(onlyImport.nodes).toEqual([]);
    expect(onlyImport.empty).toBe(true);
  });
});
