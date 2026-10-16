import type { EdgeKind, FlowEdge, FlowNode, Graph, NodeKind } from "@8n8/model";
import { describe, expect, it } from "vitest";
import {
  type Level,
  levelSize,
  projectLevel,
  ROOT_HUB,
} from "../project-level";
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

/** The wires of the code, without the hub's `contains` wires. */
const wires = (level: Level) =>
  level.edges.filter((e) => e.kind !== "contains");

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
    const ids = wires(level).map((e) => e.id);
    expect(ids.filter((id) => id === "calls:K->b")).toHaveLength(1);
    expect(wires(level)).toHaveLength(4);
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
    expect(wires(inner).map((e) => e.kind)).toEqual([
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
      edge("branch", "f/s1", "f/s1/b0/s0", "true"),
      edge("branch", "f/s1", "f/s1/b1/s0", "false"),
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
      ["f/s1", "f/s1/b0/s0", "true"],
      ["f/s1", "f/s1/b1/s0", "false"],
    ]);
  });

  it("does not show calls wires inside a function", () => {
    const level = projectLevel(g, "f");
    expect(level.edges.some((e) => e.kind === "calls")).toBe(false);
  });

  it("inside a loop shows only the loop body (CORE-10)", () => {
    const level = projectLevel(g, "f/s2");
    expect(level.nodes.map((n) => n.id)).toEqual(["f/s2/s0", "f/s2/s1"]);
    expect(wires(level).map((e) => e.id)).toEqual(["next:f/s2/s0->f/s2/s1"]);
  });
});

describe("projectLevel on a project graph (PROJ-02, 03, 04)", () => {
  it("top level shows the folders, the files of the root and the lifted imports wires only", () => {
    const level = projectLevel(lojaGraph, null);
    expect(level.nodes.map((n) => n.id)).toEqual([
      "dir:frete",
      "dir:legado",
      "dir:pedidos",
      "file:main.py",
      "file:relatorio.py",
    ]);
    expect(
      wires(level)
        .map((e) => e.id)
        .sort(),
    ).toEqual([
      "imports:dir:pedidos->dir:frete",
      "imports:file:main.py->dir:pedidos",
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
    expect(wires(level).map((e) => [e.kind, e.source, e.target])).toEqual([
      ["imports", "file:pedidos/pedidos.py", "file:pedidos/itens.py"],
    ]);
  });

  it("a file level shows its functions and drops calls to other files", () => {
    const level = projectLevel(lojaGraph, "file:pedidos/pedidos.py");
    expect(level.nodes.map((n) => n.id)).toEqual([
      "file:pedidos/pedidos.py/fn:processar_pedido",
    ]);
    expect(wires(level)).toEqual([]);
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
    expect(wires(projectLevel(p, "file:a.py")).map((e) => e.id)).toEqual([
      "calls:file:a.py/fn:f->file:a.py/fn:g",
    ]);
  });
});

describe("the hub: the open node drawn as the parent of its level", () => {
  it("the top of a project is a folder hub named after the project", () => {
    const level = projectLevel(lojaGraph, null);
    expect(level.hub?.inGraph).toBe(false);
    expect(level.hub?.node).toMatchObject({
      id: ROOT_HUB,
      kind: "folder",
      label: lojaGraph.project?.name,
    });
  });

  it("wires the hub only to the nodes no other wire reaches, in code order", () => {
    const level = projectLevel(lojaGraph, null);
    // dir:frete is imported by dir:pedidos, and dir:pedidos by main.py.
    expect(
      level.edges.filter((e) => e.kind === "contains").map((e) => e.target),
    ).toEqual(["dir:legado", "file:main.py", "file:relatorio.py"]);
  });

  it("a folder with no wires gets one contains wire per child", () => {
    const p: Graph = {
      ...graph(
        [
          node("dir:app", "folder", null, { path: "app" }),
          node("file:app/a.py", "file", "dir:app", { path: "app/a.py" }),
          node("file:app/b.py", "file", "dir:app", { path: "app/b.py" }),
        ],
        [],
      ),
      project: { name: "p" },
    };
    expect(projectLevel(p, "dir:app").edges).toEqual([
      {
        id: "contains:dir:app->file:app/a.py",
        kind: "contains",
        source: "dir:app",
        target: "file:app/a.py",
      },
      {
        id: "contains:dir:app->file:app/b.py",
        kind: "contains",
        source: "dir:app",
        target: "file:app/b.py",
      },
    ]);
  });

  it("an inner level's hub is the open node itself", () => {
    const level = projectLevel(lojaGraph, "file:pedidos/pedidos.py");
    expect(level.hub?.inGraph).toBe(true);
    expect(level.hub?.node.id).toBe("file:pedidos/pedidos.py");
  });

  it("reaches a cycle through its first node in code order", () => {
    const p: Graph = {
      ...graph(
        [
          node("file:a.py", "file", null, { path: "a.py" }),
          node("file:a.py/fn:f", "function", "file:a.py"),
          node("file:a.py/fn:g", "function", "file:a.py"),
        ],
        [
          edge("calls", "file:a.py/fn:f", "file:a.py/fn:g"),
          edge("calls", "file:a.py/fn:g", "file:a.py/fn:f"),
        ],
      ),
      project: { name: "p" },
    };
    expect(
      projectLevel(p, "file:a.py")
        .edges.filter((e) => e.kind === "contains")
        .map((e) => e.target),
    ).toEqual(["file:a.py/fn:f"]);
  });

  it("the main flow of a snippet has no hub", () => {
    expect(projectLevel(videoGraph, null).hub).toBeNull();
  });
});

describe("a file level hides loose code that runs no call", () => {
  // acesso.py: a docstring and constants, then two functions.
  const F = "file:app/acesso.py";
  const files = (moduleSteps: FlowNode[]): Graph => ({
    ...graph(
      [
        node("dir:app", "folder", null, { path: "app" }),
        node(F, "file", "dir:app", { path: "app/acesso.py" }),
        node(`${F}/mod`, "module", F, { docstring: { start: 1, end: 10 } }),
        ...moduleSteps,
        node(`${F}/fn:ativo`, "function", F),
        node(`${F}/fn:pode_acessar`, "function", F),
      ],
      [],
    ),
    project: { name: "p" },
  });

  it("drops a module of docstring and constants", () => {
    const level = projectLevel(
      files([node(`${F}/mod/s0`, "code", `${F}/mod`, { openable: false })]),
      F,
    );
    expect(level.nodes.map((n) => n.id)).toEqual([
      `${F}/fn:ativo`,
      `${F}/fn:pode_acessar`,
    ]);
  });

  it("keeps a module that runs a call on import", () => {
    const level = projectLevel(
      files([
        node(`${F}/mod/s0`, "external", `${F}/mod`, {
          openable: false,
          callee: "load_dotenv",
        }),
      ]),
      F,
    );
    expect(level.nodes.map((n) => n.id)).toContain(`${F}/mod`);
  });

  it("keeps a module with a syntax error", () => {
    const g = files([]);
    const level = projectLevel(
      {
        ...g,
        nodes: g.nodes.map((n) =>
          n.kind === "module" ? { ...n, syntaxError: { line: 3 } } : n,
        ),
      },
      F,
    );
    expect(level.nodes.map((n) => n.id)).toContain(`${F}/mod`);
  });
});

describe("levelSize counts the direct children a level shows", () => {
  const F = "file:app/acesso.py";
  const fn = `${F}/fn:pode_acessar`;
  const p: Graph = {
    ...graph(
      [
        node("dir:app", "folder", null, { path: "app" }),
        node("dir:app/sub", "folder", "dir:app", { path: "app/sub" }),
        node("file:app/sub/x.py", "file", "dir:app/sub", {
          path: "app/sub/x.py",
        }),
        node("file:app/sub/y.py", "file", "dir:app/sub", {
          path: "app/sub/y.py",
        }),
        node(F, "file", "dir:app", { path: "app/acesso.py" }),
        node(`${F}/mod`, "module", F),
        node(`${F}/mod/s0`, "code", `${F}/mod`, { openable: false }),
        node(`${F}/fn:ativo`, "function", F),
        node(fn, "function", F),
        node(`${fn}/s0`, "loop", fn),
        node(`${fn}/s0/s0`, "code", `${fn}/s0`, { openable: false }),
        node(`${fn}/s0/s1`, "code", `${fn}/s0`, { openable: false }),
        node(`${fn}/s1`, "return", fn, { openable: false }),
      ],
      [],
    ),
    project: { name: "p" },
  };
  const byId = (id: string) => p.nodes.find((n) => n.id === id) as FlowNode;
  const size = (id: string) => levelSize(p, byId(id));

  it("counts a folder's own folders and files, not what lies below them", () => {
    expect(size("dir:app")).toBe(2);
  });

  it("counts a file's cards, without the loose code it hides", () => {
    expect(size(F)).toBe(2);
  });

  it("counts a function's steps, not the steps inside its loop", () => {
    expect(size(fn)).toBe(2);
  });

  it("matches the number on the hub once the node is open", () => {
    for (const id of ["dir:app", "dir:app/sub", F, fn]) {
      expect(size(id)).toBe(projectLevel(p, id).nodes.length);
    }
  });

  it("gives no number to a loop, a block or a call", () => {
    expect(size(`${fn}/s0`)).toBeUndefined();
    expect(levelSize(p, node("b", "block", fn))).toBeUndefined();
    expect(levelSize(p, node("c", "call", fn, { target: fn }))).toBeUndefined();
  });
});
