import type {
  EdgeKind,
  FlowEdge,
  FlowNode,
  Graph,
  NodeKind,
} from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { projectLevel } from "../project-level";
import { lojaGraph } from "./loja-graph";
import { videoGraph } from "./video-graph";

function node(
  id: string,
  kind: NodeKind,
  parentId: string | null,
  extra: Partial<FlowNode> = {},
): FlowNode {
  return {
    id,
    kind,
    label: id,
    parentId,
    range: { start: 1, end: 1 },
    openable: true,
    ...extra,
  };
}

function edge(
  kind: EdgeKind,
  source: string,
  target: string,
  label?: string,
): FlowEdge {
  return {
    id: `${kind}:${source}->${target}`,
    kind,
    source,
    target,
    ...(label === undefined ? {} : { label }),
  };
}

function graph(nodes: FlowNode[], edges: FlowEdge[]): Graph {
  return { language: "python", empty: false, nodes, edges };
}

describe("projectLevel lifts calls wires on a file level (CORE-02)", () => {
  // The old snippet top level, moved under a project file: the top of a
  // snippet is now the main flow (VID-10), and `lifted` keeps its rules here.
  const F = "file:x.py";
  const p: Graph = {
    ...graph(
      [
        node("dir:.", "folder", null, { path: "" }),
        node(F, "file", "dir:.", { path: "x.py" }),
        node("mod", "module", F),
        node("mod/s0", "call", "mod", { target: "a" }),
        node("a", "function", F),
        node("a/s0", "call", "a", { target: "b" }),
        node("b", "function", F),
        node("K", "class", F),
        node("K.m", "function", "K"),
        node("K.m/s0", "call", "K.m", { target: "b" }),
        node("K.n", "function", "K"),
        node("K.n/s0", "call", "K.m", { target: "K.n" }),
      ],
      [
        edge("calls", "mod", "a"),
        edge("calls", "a", "b"),
        edge("calls", "K.m", "b"),
        edge("calls", "K.m", "K.n"),
        edge("calls", "K.n", "b"),
        edge("calls", "b", "K.m"),
        edge("next", "mod/s0", "a/s0"),
      ],
    ),
    project: { name: "p" },
  };
  const level = projectLevel(p, F);

  it("shows only function, class and module nodes (CORE-01, 03)", () => {
    expect(level.nodes.map((n) => n.id)).toEqual(["mod", "a", "b", "K"]);
  });

  it("keeps a calls wire between functions (CORE-02)", () => {
    expect(level.edges.map((e) => e.id)).toContain("calls:a->b");
  });

  it("lifts a method-to-function wire up to the class (CORE-02)", () => {
    expect(level.edges.map((e) => e.id)).toContain("calls:K->b");
  });

  it("drops a wire from a class to itself (CORE-02)", () => {
    const ids = level.edges.map((e) => e.id);
    expect(ids).not.toContain("calls:K->K");
  });

  it("collapses equal wires into one (CORE-02)", () => {
    const ids = level.edges.map((e) => e.id);
    expect(ids.filter((id) => id === "calls:K->b")).toHaveLength(1);
    expect(level.edges).toHaveLength(4);
    expect(ids).toContain("calls:b->K");
    expect(ids).toContain("calls:mod->a");
  });

  it("has no rows and no triggers", () => {
    expect(level.rows).toBeUndefined();
    expect(level.triggers.size).toBe(0);
  });
});

describe("VID-10, 11, 12: the top level of a snippet is the main flow", () => {
  const P = "fn:processar_pedido";
  const steps = [0, 1, 2, 3, 4, 5, 6].map((i) => `${P}/s${i}`);
  const level = projectLevel(videoGraph, null);

  it("shows processar_pedido and its 7 steps with a call, in order", () => {
    expect(level.nodes.map((n) => n.id)).toEqual([P, ...steps]);
    expect(level.rows).toEqual([[P, ...steps]]);
  });

  it("links neighbours with 7 synthetic next wires main:<a>-><b>", () => {
    const chain = [P, ...steps];
    expect(level.edges).toEqual(
      chain.slice(1).map((target, i) => ({
        id: `main:${chain[i]}->${target}`,
        kind: "next",
        source: chain[i],
        target,
      })),
    );
  });

  it("marks only processar_pedido as trigger", () => {
    expect([...level.triggers]).toEqual([P]);
  });

  it("shows loose code only as a trigger, never as a plain Módulo node (VID-12)", () => {
    const g = graph(
      [
        node("mod", "module", null, { range: { start: 1, end: 1 } }),
        node("mod/s0", "call", "mod", {
          target: "a",
          range: { start: 1, end: 1 },
        }),
        node("a", "function", null, { range: { start: 3, end: 4 } }),
        node("b", "function", null, { range: { start: 6, end: 7 } }),
        node("b/s0", "external", "b", {
          callee: "print",
          range: { start: 7, end: 7 },
        }),
      ],
      [edge("calls", "mod", "a")],
    );
    const top = projectLevel(g, null);
    expect(top.rows).toEqual([
      ["mod", "mod/s0"],
      ["b", "b/s0"],
    ]);
    expect(top.nodes.map((n) => n.id)).toEqual(["mod", "mod/s0", "b", "b/s0"]);
    expect([...top.triggers]).toEqual(["mod", "b"]);
    for (const n of top.nodes) {
      if (n.kind === "module") expect(top.triggers.has(n.id)).toBe(true);
    }
    expect(top.edges.map((e) => e.id)).toEqual([
      "main:mod->mod/s0",
      "main:b->b/s0",
    ]);
  });

  it("an inner level keeps its wires and has no triggers", () => {
    const inner = projectLevel(videoGraph, "fn:calcular_frete");
    expect(inner.triggers.size).toBe(0);
    expect(inner.rows).toBeUndefined();
    expect(inner.edges.map((e) => e.kind)).toEqual([
      "next",
      "next",
      "branch",
      "branch",
    ]);
  });

  it("a project top level has no triggers", () => {
    const top = projectLevel(lojaGraph, null);
    expect(top.triggers.size).toBe(0);
    expect(top.rows).toBeUndefined();
  });
});

describe("projectLevel inside a container", () => {
  const g = graph(
    [
      node("f", "function", null),
      node("f/s0", "code", "f"),
      node("f/s1", "condition", "f"),
      node("f/s1/b0/s0", "call", "f", { target: "g" }),
      node("f/s1/b1/s0", "code", "f"),
      node("f/s2", "loop", "f"),
      node("f/s2/s0", "code", "f/s2"),
      node("f/s2/s1", "call", "f/s2", { target: "g" }),
      node("g", "function", null),
    ],
    [
      edge("next", "f/s0", "f/s1"),
      edge("branch", "f/s1", "f/s1/b0/s0", "sim"),
      edge("branch", "f/s1", "f/s1/b1/s0", "não"),
      edge("next", "f/s1/b0/s0", "f/s2"),
      edge("next", "f/s1/b1/s0", "f/s2"),
      edge("next", "f/s2/s0", "f/s2/s1"),
      edge("calls", "f", "g"),
    ],
  );

  it("shows only the direct children, in order, with next wires (CORE-08, 13)", () => {
    const level = projectLevel(g, "f");
    expect(level.nodes.map((n) => n.id)).toEqual([
      "f/s0",
      "f/s1",
      "f/s1/b0/s0",
      "f/s1/b1/s0",
      "f/s2",
    ]);
    expect(level.edges.map((e) => e.id)).toContain("next:f/s0->f/s1");
  });

  it("shows branch steps on the same level with labelled branch wires (CORE-09)", () => {
    const level = projectLevel(g, "f");
    const branches = level.edges.filter((e) => e.kind === "branch");
    expect(branches.map((e) => [e.source, e.target, e.label])).toEqual([
      ["f/s1", "f/s1/b0/s0", "sim"],
      ["f/s1", "f/s1/b1/s0", "não"],
    ]);
  });

  it("does not show calls wires inside a function", () => {
    const level = projectLevel(g, "f");
    expect(level.edges.some((e) => e.kind === "calls")).toBe(false);
  });

  it("inside a loop shows only the loop body (CORE-10)", () => {
    const level = projectLevel(g, "f/s2");
    expect(level.nodes.map((n) => n.id)).toEqual(["f/s2/s0", "f/s2/s1"]);
    expect(level.edges.map((e) => e.id)).toEqual(["next:f/s2/s0->f/s2/s1"]);
  });
});

describe("projectLevel on a project graph (PROJ-02, 03, 04)", () => {
  it("top level shows the folders and the lifted imports wires only", () => {
    const level = projectLevel(lojaGraph, null);
    expect(level.nodes.map((n) => n.id)).toEqual([
      "dir:.",
      "dir:frete",
      "dir:legado",
      "dir:pedidos",
    ]);
    expect(level.edges.map((e) => e.id).sort()).toEqual([
      "imports:dir:.->dir:pedidos",
      "imports:dir:pedidos->dir:frete",
    ]);
    expect(level.edges.some((e) => e.kind === "calls")).toBe(false);
  });

  it("a folder level shows its files and drops a wire leaving the folder", () => {
    const level = projectLevel(lojaGraph, "dir:pedidos");
    expect(level.nodes.map((n) => n.id)).toEqual([
      "file:pedidos/__init__.py",
      "file:pedidos/itens.py",
      "file:pedidos/pedidos.py",
    ]);
    expect(level.edges.map((e) => [e.kind, e.source, e.target])).toEqual([
      ["imports", "file:pedidos/pedidos.py", "file:pedidos/itens.py"],
    ]);
  });

  it("a file level shows its functions and drops calls to other files", () => {
    const level = projectLevel(lojaGraph, "file:pedidos/pedidos.py");
    expect(level.nodes.map((n) => n.id)).toEqual([
      "file:pedidos/pedidos.py/fn:processar_pedido",
    ]);
    expect(level.edges).toEqual([]);
  });

  it("a file level keeps a lifted calls wire inside the file", () => {
    const p: Graph = {
      ...graph(
        [
          node("dir:.", "folder", null, { path: "" }),
          node("file:a.py", "file", "dir:.", { path: "a.py" }),
          node("file:a.py/fn:f", "function", "file:a.py"),
          node("file:a.py/fn:f/s0", "call", "file:a.py/fn:f", {
            target: "file:a.py/fn:g",
          }),
          node("file:a.py/fn:g", "function", "file:a.py"),
        ],
        [edge("calls", "file:a.py/fn:f", "file:a.py/fn:g")],
      ),
      project: { name: "p" },
    };
    expect(projectLevel(p, "file:a.py").edges.map((e) => e.id)).toEqual([
      "calls:file:a.py/fn:f->file:a.py/fn:g",
    ]);
  });
});
