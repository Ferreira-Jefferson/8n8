import { readFileSync } from "node:fs";
import type { FlowNode, Graph } from "@8n8/model";
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

  it("keeps a call-free return out of the preceding code group (VID-20)", async () => {
    const graph = await graphOf(
      lines("def x():", "    a = 1", "    b = 2", "    return a + b"),
    );

    const steps = stepsOf(graph, "fn:x");
    expect(steps.map((n) => [n.kind, n.range])).toEqual([
      ["code", { start: 2, end: 3 }],
      ["return", { start: 4, end: 4 }],
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

  it("turns DB calls on chained and indexed receivers into BANCO steps (CORE-12)", async () => {
    const graph = await graphOf(
      lines(
        "def x(conn, c, q):",
        "    conn.cursor().execute(q)",
        "    c[0].commit()",
      ),
    );

    expect(
      stepsOf(graph, "fn:x").map((n) => [n.id, n.kind, n.category]),
    ).toEqual([
      ["fn:x/s0", "external", "BANCO"],
      ["fn:x/s1", "external", "BANCO"],
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

/** Branch wires leaving `conditionId`, as [target, label]. */
function branchesOf(
  graph: Graph,
  conditionId: string,
): [string, string | undefined][] {
  return graph.edges
    .filter((e) => e.kind === "branch" && e.source === conditionId)
    .map((e) => [e.target, e.label]);
}

describe("buildSteps: condition and branches (CORE-09)", () => {
  it("opens calcular_frete into HTTP, Código and the condition peso > 30 with sim and não", async () => {
    const graph = await graphOf(videoFixture);

    const top = stepsOf(graph, "fn:calcular_frete").filter(
      (n) => !n.id.includes("/b"),
    );
    expect(top.map((n) => [n.kind, n.label])).toEqual([
      ["external", "requests.get"],
      ["code", "Código"],
      ["condition", "peso > 30"],
    ]);
    expect(top[0]?.category).toBe("HTTP");
    expect(top[2]).toEqual({
      id: "fn:calcular_frete/s2",
      kind: "condition",
      label: "peso > 30",
      parentId: "fn:calcular_frete",
      range: { start: 8, end: 11 },
      openable: false,
    });
    expect(
      graph.edges.filter((e) => e.source === "fn:calcular_frete/s2"),
    ).toEqual([
      {
        id: "branch:fn:calcular_frete/s2->fn:calcular_frete/s2/b0/s0",
        kind: "branch",
        source: "fn:calcular_frete/s2",
        target: "fn:calcular_frete/s2/b0/s0",
        label: "sim",
      },
      {
        id: "branch:fn:calcular_frete/s2->fn:calcular_frete/s2/b1/s0",
        kind: "branch",
        source: "fn:calcular_frete/s2",
        target: "fn:calcular_frete/s2/b1/s0",
        label: "não",
      },
    ]);
  });

  it("labels if/elif/else wires sim, the elif text and não", async () => {
    const graph = await graphOf(
      lines(
        "def f(x):",
        "    if x > 10:",
        "        a = 1",
        "    elif x > 5:",
        "        a = 2",
        "    else:",
        "        a = 3",
      ),
    );

    expect(branchesOf(graph, "fn:f/s0")).toEqual([
      ["fn:f/s0/b0/s0", "sim"],
      ["fn:f/s0/b1/s0", "x > 5"],
      ["fn:f/s0/b2/s0", "não"],
    ]);
  });

  it("sends não to the next step when the if has no else", async () => {
    const graph = await graphOf(
      lines("def f(x):", "    if x:", "        a = 1", "    return 0"),
    );

    expect(branchesOf(graph, "fn:f/s0")).toEqual([
      ["fn:f/s0/b0/s0", "sim"],
      ["fn:f/s1", "não"],
    ]);
  });

  it("creates no não wire when the if has no else and no next step", async () => {
    const graph = await graphOf(
      lines("def f(x):", "    if x:", "        a = 1"),
    );

    expect(branchesOf(graph, "fn:f/s0")).toEqual([["fn:f/s0/b0/s0", "sim"]]);
  });

  it("gives branch steps the parent of the condition and ids b<j>/s<i>", async () => {
    const graph = await graphOf(
      lines(
        "def f(x):",
        "    if x:",
        "        a = 1",
        "    else:",
        "        b = 2",
      ),
    );

    expect(stepsOf(graph, "fn:f").map((n) => n.id)).toEqual([
      "fn:f/s0",
      "fn:f/s0/b0/s0",
      "fn:f/s0/b1/s0",
    ]);
  });
});

function node(graph: Graph, id: string): FlowNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

describe("buildSteps: loops and blocks (CORE-10)", () => {
  it("turns the video loop into an openable for item in itens with a call to calcular_frete inside", async () => {
    const graph = await graphOf(videoFixture);

    const loop = stepsOf(graph, "fn:processar_pedido").find(
      (n) => n.kind === "loop",
    );
    expect(loop).toEqual({
      id: "fn:processar_pedido/s1",
      kind: "loop",
      label: "for item in itens",
      parentId: "fn:processar_pedido",
      range: { start: 16, end: 17 },
      openable: true,
    });
    expect(stepsOf(graph, "fn:processar_pedido/s1")).toEqual([
      {
        id: "fn:processar_pedido/s1/s0",
        kind: "call",
        label: "calcular_frete",
        parentId: "fn:processar_pedido/s1",
        range: { start: 17, end: 17 },
        openable: true,
        target: "fn:calcular_frete",
      },
    ]);
  });

  it("turns while into a loop whose body steps are its children", async () => {
    const graph = await graphOf(
      lines(
        "def f(n):",
        "    while n > 0:",
        "        n = n - 1",
        "    return n",
      ),
    );

    expect(node(graph, "fn:f/s0")).toMatchObject({
      kind: "loop",
      label: "while n > 0",
      openable: true,
    });
    expect(stepsOf(graph, "fn:f/s0").map((n) => [n.id, n.kind])).toEqual([
      ["fn:f/s0/s0", "code"],
    ]);
  });

  it("turns try into an openable block with its body as children", async () => {
    const graph = await graphOf(
      lines(
        "def f():",
        "    try:",
        "        a = 1",
        "    except ValueError:",
        "        a = 2",
      ),
    );

    expect(node(graph, "fn:f/s0")).toMatchObject({
      kind: "block",
      label: "try",
      openable: true,
    });
    // The try body and the except body are both inside the block.
    expect(
      stepsOf(graph, "fn:f/s0").map((n) => [n.id, n.kind, n.range]),
    ).toEqual([["fn:f/s0/s0", "code", { start: 3, end: 5 }]]);
  });

  it("turns with into an openable block with its body as children", async () => {
    const graph = await graphOf(
      lines("def f(lock):", "    with lock:", "        a = 1"),
    );

    expect(node(graph, "fn:f/s0")).toMatchObject({
      kind: "block",
      label: "with lock",
      openable: true,
    });
    expect(stepsOf(graph, "fn:f/s0").map((n) => [n.kind, n.range])).toEqual([
      ["code", { start: 3, end: 3 }],
    ]);
  });

  it("turns match into an openable block with the case bodies as children", async () => {
    const graph = await graphOf(
      lines(
        "def f(x):",
        "    match x:",
        "        case 1:",
        "            a = 1",
        "        case _:",
        "            a = 2",
      ),
    );

    expect(node(graph, "fn:f/s0")).toMatchObject({
      kind: "block",
      label: "match x",
      openable: true,
    });
    expect(stepsOf(graph, "fn:f/s0").map((n) => [n.kind, n.range])).toEqual([
      ["code", { start: 4, end: 6 }],
    ]);
  });

  it("classifies the open call of with open(p) as f as ARQUIVO", async () => {
    const graph = await graphOf(
      lines("def f(p):", "    with open(p) as f:", "        dados = f.read()"),
    );

    expect(stepsOf(graph, "fn:f/s0")[0]).toMatchObject({
      kind: "external",
      callee: "open",
      category: "ARQUIVO",
      range: { start: 2, end: 2 },
    });
  });
});

/** Every wire, as [source, target]. */
function wires(graph: Graph): [string, string][] {
  return graph.edges.map((e) => [e.source, e.target]);
}

describe("buildSteps: return (VID-20)", () => {
  it("turns return into a step of its own after the code group", async () => {
    const graph = await graphOf(lines("def x():", "    a = 1", "    return a"));

    expect(stepsOf(graph, "fn:x")).toEqual([
      {
        id: "fn:x/s0",
        kind: "code",
        label: "Código",
        parentId: "fn:x",
        range: { start: 2, end: 2 },
        openable: false,
      },
      {
        id: "fn:x/s1",
        kind: "return",
        label: "a",
        parentId: "fn:x",
        range: { start: 3, end: 3 },
        openable: false,
      },
    ]);
    expect(edgeIds(graph, "next")).toEqual(["next:fn:x/s0->fn:x/s1"]);
  });

  it("sends no wire from a return to the statement after it", async () => {
    const graph = await graphOf(lines("def x():", "    return 1", "    a = 2"));

    expect(stepsOf(graph, "fn:x").map((n) => [n.id, n.kind])).toEqual([
      ["fn:x/s0", "return"],
      ["fn:x/s1", "code"],
    ]);
    expect(graph.edges).toEqual([]);
  });

  it("gives each branch of an if/else with returns its own return and leaves no wire after the if", async () => {
    const graph = await graphOf(
      lines(
        "def f(x):",
        "    if x:",
        "        return 1",
        "    else:",
        "        return 2",
        "    a = 3",
      ),
    );

    expect(stepsOf(graph, "fn:f").map((n) => [n.id, n.kind])).toEqual([
      ["fn:f/s0", "condition"],
      ["fn:f/s0/b0/s0", "return"],
      ["fn:f/s0/b1/s0", "return"],
      ["fn:f/s1", "code"],
    ]);
    expect(wires(graph)).toEqual([
      ["fn:f/s0", "fn:f/s0/b0/s0"],
      ["fn:f/s0", "fn:f/s0/b1/s0"],
    ]);
  });

  it("keeps não going to the next step when only the sim branch returns", async () => {
    const graph = await graphOf(
      lines("def f(x):", "    if x:", "        return 1", "    a = 2"),
    );

    expect(branchesOf(graph, "fn:f/s0")).toEqual([
      ["fn:f/s0/b0/s0", "sim"],
      ["fn:f/s1", "não"],
    ]);
    expect(wires(graph)).toEqual([
      ["fn:f/s0", "fn:f/s0/b0/s0"],
      ["fn:f/s0", "fn:f/s1"],
    ]);
  });

  it("makes a return inside a loop a child of the loop", async () => {
    const graph = await graphOf(
      lines("def f(itens):", "    for i in itens:", "        return i"),
    );

    expect(stepsOf(graph, "fn:f/s0")).toEqual([
      {
        id: "fn:f/s0/s0",
        kind: "return",
        label: "i",
        parentId: "fn:f/s0",
        range: { start: 3, end: 3 },
        openable: false,
      },
    ]);
  });

  it("gives a return that calls the snippet a target and keeps the calls wire", async () => {
    const graph = await graphOf(
      lines(
        "def calcular(x):",
        "    pass",
        "def f(x):",
        "    return calcular(x)",
      ),
    );

    expect(node(graph, "fn:f/s0")).toEqual({
      id: "fn:f/s0",
      kind: "return",
      label: "calcular(x)",
      parentId: "fn:f",
      range: { start: 4, end: 4 },
      openable: false,
      target: "fn:calcular",
    });
    expect(edgeIds(graph, "calls")).toEqual(["calls:fn:f->fn:calcular"]);
  });

  it("gives a return with an external call its callee and category", async () => {
    const graph = await graphOf(
      lines("import requests", "def f(u):", "    return requests.get(u)"),
    );

    expect(node(graph, "fn:f/s0")).toEqual({
      id: "fn:f/s0",
      kind: "return",
      label: "requests.get(u)",
      parentId: "fn:f",
      range: { start: 3, end: 3 },
      openable: false,
      callee: "requests.get",
      category: "HTTP",
    });
    expect(edgeIds(graph, "calls")).toEqual([]);
  });

  it("labels a bare return with an empty text", async () => {
    const graph = await graphOf(lines("def f():", "    return"));

    expect(node(graph, "fn:f/s0")).toMatchObject({ kind: "return", label: "" });
  });

  it("turns the returns of calcular_frete into return steps with the same ids", async () => {
    const graph = await graphOf(videoFixture);

    expect(
      ["fn:calcular_frete/s2/b0/s0", "fn:calcular_frete/s2/b1/s0"].map((id) =>
        node(graph, id),
      ),
    ).toEqual([
      {
        id: "fn:calcular_frete/s2/b0/s0",
        kind: "return",
        label: "base + taxa * 2",
        parentId: "fn:calcular_frete",
        range: { start: 9, end: 9 },
        openable: false,
      },
      {
        id: "fn:calcular_frete/s2/b1/s0",
        kind: "return",
        label: "base + taxa",
        parentId: "fn:calcular_frete",
        range: { start: 11, end: 11 },
        openable: false,
      },
    ]);
  });
});
