import { readFileSync } from "node:fs";
import type { FlowNode, Graph } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { type BuildOptions, buildGraph } from "../build-graph";
import { loadPythonParser } from "../parse";

const videoFixture = readFileSync(
  new URL("./fixtures/pedido_frete.py", import.meta.url),
  "utf8",
);

async function graphOf(
  source: string,
  options: BuildOptions = {},
): Promise<Graph> {
  const parser = await loadPythonParser();
  const tree = parser.parse(source);
  if (!tree) throw new Error("parse failed");
  return buildGraph(tree, options);
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

function callsIds(graph: Graph): string[] {
  return graph.edges.filter((e) => e.kind === "calls").map((e) => e.id);
}

function lines(...rows: string[]): string {
  return `${rows.join("\n")}\n`;
}

describe("buildGraph: calls wires (CORE-02)", () => {
  it("wires processar_pedido to calcular_frete exactly once, even from inside the loop", async () => {
    const graph = await graphOf(videoFixture);

    expect(graph.edges.filter((e) => e.kind === "calls")).toEqual([
      {
        id: "calls:fn:processar_pedido->fn:calcular_frete",
        kind: "calls",
        source: "fn:processar_pedido",
        target: "fn:calcular_frete",
      },
    ]);
  });

  it("creates one wire for two calls from A to B", async () => {
    const graph = await graphOf(
      lines(
        "def b():",
        "    return 1",
        "def a():",
        "    x = b()",
        "    y = 2",
        "    z = b()",
      ),
    );

    expect(callsIds(graph)).toEqual(["calls:fn:a->fn:b"]);
  });

  it("wires a method that calls a top-level function from the method id", async () => {
    const graph = await graphOf(
      lines(
        "def ajuda():",
        "    return 1",
        "class Pedido:",
        "    def validar(self):",
        "        return ajuda()",
      ),
    );

    expect(callsIds(graph)).toEqual(["calls:cls:Pedido/fn:validar->fn:ajuda"]);
  });

  it("wires a loose call in the module from mod", async () => {
    const graph = await graphOf(lines("def main():", "    return 1", "main()"));

    expect(callsIds(graph)).toEqual(["calls:mod->fn:main"]);
  });

  it("gives a function that calls nothing in the snippet no outgoing calls wire", async () => {
    const graph = await graphOf(videoFixture);

    expect(
      graph.edges.filter(
        (e) => e.kind === "calls" && e.source === "fn:calcular_frete",
      ),
    ).toEqual([]);
  });
});

describe("buildGraph: calls to names the snippet does not define (VID-13)", () => {
  const source = lines(
    "def processar(p, x):",
    "    validar_pedido(p)",
    "    db.salvar(p)",
    "    enviar_email(x)",
    "    print(x)",
    "    n = len(x)",
  );

  it("turns each call into an external step with its category", async () => {
    const graph = await graphOf(source);

    expect(
      graph.nodes
        .filter((n) => n.parentId === "fn:processar")
        .map((n) => [n.id, n.kind, n.callee, n.category]),
    ).toEqual([
      ["fn:processar/s0", "external", "validar_pedido", "EXTERNO"],
      ["fn:processar/s1", "external", "db.salvar", "BANCO"],
      ["fn:processar/s2", "external", "enviar_email", "EMAIL"],
      ["fn:processar/s3", "external", "print", "EXTERNO"],
      ["fn:processar/s4", "external", "len", "EXTERNO"],
    ]);
  });

  it("creates no calls wire for them", async () => {
    const graph = await graphOf(source);

    expect(callsIds(graph)).toEqual([]);
  });

  it("keeps a name defined in the snippet a call (CORE-02)", async () => {
    const graph = await graphOf(
      lines(
        "def validar_pedido(p):",
        "    pass",
        "def f(p):",
        "    validar_pedido(p)",
      ),
    );

    expect(byId(graph, "fn:f/s0")).toMatchObject({
      kind: "call",
      target: "fn:validar_pedido",
    });
    expect(callsIds(graph)).toEqual(["calls:fn:f->fn:validar_pedido"]);
  });

  it("keeps a project name without an import an EXTERNO step with no wire (PROJ-09)", async () => {
    const graph = await graphOf(lines("def f(p):", "    calcular_frete(p)"), {
      projectNames: new Set(["calcular_frete"]),
    });

    expect(byId(graph, "fn:f/s0")).toMatchObject({
      kind: "external",
      callee: "calcular_frete",
      category: "EXTERNO",
    });
    expect(callsIds(graph)).toEqual([]);
  });

  it("keeps a call on a chained receiver outside the table in the code step", async () => {
    const graph = await graphOf(lines("def f(x):", "    foo().append(x)"));

    expect(byId(graph, "fn:f/s0")).toMatchObject({ kind: "code" });
  });
});
