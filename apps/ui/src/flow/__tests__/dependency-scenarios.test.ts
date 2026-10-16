import type { EdgeKind, FlowEdge, FlowNode, Graph, NodeKind } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { backWires, wireSides } from "../dependency";
import { layoutLR, layoutRows, NODE_HEIGHT, NODE_WIDTH } from "../layout";
import { mainFlowRows } from "../main-flow";
import { projectLevel } from "../project-level";
import { Side } from "../sides";

// Rare and awkward shapes of the call and inheritance graph. Each scenario
// builds a graph by hand, asks for the level, and checks what the screen draws:
// which wires, which sides, and that nothing throws or runs behind a card.

function node(
  id: string,
  kind: NodeKind,
  parentId: string | null,
  start: number,
  extra: Partial<FlowNode> = {},
): FlowNode {
  return {
    id,
    kind,
    label: id,
    parentId,
    range: { start, end: start },
    openable: true,
    ...extra,
  };
}

function wire(
  kind: EdgeKind,
  source: string,
  target: string,
  extra: Partial<FlowEdge> = {},
): FlowEdge {
  return { id: `${kind}:${source}->${target}`, kind, source, target, ...extra };
}

function snippet(nodes: FlowNode[], edges: FlowEdge[]): Graph {
  return { language: "python", empty: nodes.length === 0, nodes, edges };
}

/** `count` top functions f0..f(count-1), in code order. */
function functions(count: number): FlowNode[] {
  return Array.from({ length: count }, (_, i) =>
    node(`fn:f${i}`, "function", null, i * 3 + 1),
  );
}

const deps = (level: ReturnType<typeof projectLevel>) =>
  level.edges.filter((e) => e.kind !== "next" && e.kind !== "contains");

/** The positions the screen gives a snippet's rows. */
function placed(graph: Graph) {
  const level = projectLevel(graph, null);
  const positions = layoutRows(level.rows ?? []);
  return {
    level,
    positions,
    sides: wireSides(level.edges, positions, { rows: true }),
  };
}

describe("a cycle of three calls on the main flow", () => {
  const graph = snippet(functions(3), [
    wire("calls", "fn:f0", "fn:f1"),
    wire("calls", "fn:f1", "fn:f2"),
    wire("calls", "fn:f2", "fn:f0"),
  ]);
  const { level, sides } = placed(graph);

  it("draws all three wires, one per pair", () => {
    expect(deps(level)).toHaveLength(3);
  });

  it("sends the wires between neighbours down and up, facing each other", () => {
    expect(sides.get("calls:fn:f0->fn:f1")).toEqual([Side.Bottom, Side.Top]);
    expect(sides.get("calls:fn:f1->fn:f2")).toEqual([Side.Bottom, Side.Top]);
  });

  it("sends the wire that skips the middle card around it, by the left sides", () => {
    expect(sides.get("calls:fn:f2->fn:f0")).toEqual([Side.Left, Side.Left]);
  });
});

describe("a wire never runs behind a card (main flow)", () => {
  it("checks every pair of a stack of six functions that all call each other", () => {
    const nodes = functions(6);
    const edges: FlowEdge[] = [];
    for (const a of nodes)
      for (const b of nodes)
        if (a.id !== b.id) edges.push(wire("calls", a.id, b.id));
    const { level, positions, sides } = placed(snippet(nodes, edges));
    expect(deps(level)).toHaveLength(30);
    const gap = (id: string) => positions.get(id);
    for (const e of deps(level)) {
      const [out] = sides.get(e.id) ?? [];
      const from = gap(e.source);
      const to = gap(e.target);
      if (!from || !to || out === undefined) throw new Error("missing");
      // A straight vertical wire only joins two neighbours; the others go round by the left.
      const between = Math.abs(from.y - to.y) / (NODE_HEIGHT + 170) - 1;
      if (between > 0.5) expect(out).toBe(Side.Left);
    }
  });
});

describe("a function that calls itself and is called back", () => {
  const graph = snippet(functions(2), [
    wire("calls", "fn:f0", "fn:f0"),
    wire("calls", "fn:f0", "fn:f1"),
    wire("calls", "fn:f1", "fn:f0"),
  ]);
  const { level, sides } = placed(graph);

  it("keeps the loop, the wire and the wire back", () => {
    expect(deps(level).map((e) => e.id)).toEqual([
      "calls:fn:f0->fn:f0",
      "calls:fn:f0->fn:f1",
      "calls:fn:f1->fn:f0",
    ]);
  });

  it("gives the loop no sides of its own (it keeps right and left) and the back wire the other sides", () => {
    expect(sides.has("calls:fn:f0->fn:f0")).toBe(false);
    expect(sides.get("calls:fn:f0->fn:f1")).toEqual([Side.Bottom, Side.Top]);
    expect(sides.get("calls:fn:f1->fn:f0")).toEqual([Side.Left, Side.Left]);
  });
});

describe("a function called by six others, and one that calls six", () => {
  const nodes = functions(7);
  const callers = nodes.slice(0, 6).map((n) => wire("calls", n.id, "fn:f6"));
  const callees = nodes.slice(1).map((n) => wire("calls", "fn:f0", n.id));

  it("draws one wire per caller, all into the same function", () => {
    const { level } = placed(snippet(nodes, callers));
    expect(deps(level).map((e) => e.target)).toEqual(Array(6).fill("fn:f6"));
  });

  it("draws one wire per callee, all out of the same function", () => {
    const { level } = placed(snippet(nodes, callees));
    expect(deps(level).map((e) => e.source)).toEqual(Array(6).fill("fn:f0"));
  });

  it("gives every wire of both fans sides", () => {
    for (const edges of [callers, callees]) {
      const { level, sides } = placed(snippet(nodes, edges));
      for (const e of deps(level)) expect(sides.has(e.id)).toBe(true);
    }
  });
});

describe("inheritance on the main flow", () => {
  const classes = ["A", "B", "C", "D"].map((n, i) =>
    node(`cls:${n}`, "class", null, i * 3 + 1),
  );

  it("draws a chain A <- B <- C", () => {
    const { level } = placed(
      snippet(classes.slice(0, 3), [
        wire("extends", "cls:B", "cls:A"),
        wire("extends", "cls:C", "cls:B"),
      ]),
    );
    expect(deps(level).map((e) => e.id)).toEqual([
      "extends:cls:B->cls:A",
      "extends:cls:C->cls:B",
    ]);
  });

  it("draws a diamond: D extends B and C, which both extend A", () => {
    const { level } = placed(
      snippet(classes, [
        wire("extends", "cls:B", "cls:A"),
        wire("extends", "cls:C", "cls:A"),
        wire("extends", "cls:D", "cls:B"),
        wire("extends", "cls:D", "cls:C"),
      ]),
    );
    expect(deps(level)).toHaveLength(4);
  });

  it("draws one wire when a class both extends and calls its base: the call", () => {
    const { level } = placed(
      snippet(classes.slice(0, 2), [
        wire("extends", "cls:B", "cls:A"),
        wire("calls", "cls:B", "cls:A"),
      ]),
    );
    expect(deps(level).map((e) => e.kind)).toEqual(["calls"]);
  });

  it("shows a snippet of only classes, with no function and no steps", () => {
    const rows = mainFlowRows(snippet(classes.slice(0, 2), []));
    expect(rows.map((r) => [r.entry, r.steps])).toEqual([
      ["cls:A", []],
      ["cls:B", []],
    ]);
  });
});

describe("odd snippets", () => {
  it("has no rows and no wires for loose code with no call", () => {
    const g = snippet(
      [node("mod", "module", null, 1), node("mod/s0", "code", "mod", 1)],
      [],
    );
    const level = projectLevel(g, null);
    expect(level.rows).toEqual([]);
    expect(level.edges).toEqual([]);
  });

  it("drops a wire whose target is not on the level", () => {
    const g = snippet(functions(1), [wire("calls", "fn:f0", "fn:ghost")]);
    expect(deps(projectLevel(g, null))).toEqual([]);
  });

  it("keeps functions with the same name apart (fn:x and fn:x#2)", () => {
    const g = snippet(
      [
        node("fn:x", "function", null, 1),
        node("fn:x#2", "function", null, 4),
        node("fn:y", "function", null, 7),
      ],
      [wire("calls", "fn:y", "fn:x#2"), wire("calls", "fn:y", "fn:x")],
    );
    expect(
      deps(projectLevel(g, null))
        .map((e) => e.target)
        .sort(),
    ).toEqual(["fn:x", "fn:x#2"]);
  });

  it("builds a level of 40 functions in a call chain, with a wire per link", () => {
    const nodes = functions(40);
    const edges = nodes.slice(1).map((n, i) => wire("calls", `fn:f${i}`, n.id));
    const started = performance.now();
    const { level, sides } = placed(snippet(nodes, edges));
    expect(performance.now() - started).toBeLessThan(500);
    expect(deps(level)).toHaveLength(39);
    expect(sides.size).toBe(39);
  });

  it("keeps a syntax-error node with no wire", () => {
    const g = snippet(
      [
        node("mod", "module", null, 1, { syntaxError: { line: 1 } }),
        ...functions(1),
      ],
      [],
    );
    expect(mainFlowRows(g).map((r) => r.entry)).toEqual(["mod", "fn:f0"]);
  });
});

describe("a project, level by level", () => {
  const p: Graph = {
    ...snippet(
      [
        node("dir:.", "folder", null, 1, { path: "" }),
        node("file:a.py", "file", "dir:.", 1, { path: "a.py" }),
        node("file:a.py/cls:A", "class", "file:a.py", 1),
        node("file:a.py/fn:f", "function", "file:a.py", 5),
        node("file:b.py", "file", "dir:.", 1, { path: "b.py" }),
        node("file:b.py/cls:B", "class", "file:b.py", 1),
        node("file:b.py/fn:g", "function", "file:b.py", 5),
        node("file:c.py", "file", "dir:.", 1, { path: "c.py" }),
        node("file:c.py/fn:h", "function", "file:c.py", 1),
        node("file:d.ts", "file", "dir:.", 1, { path: "d.ts" }),
        node("file:d.ts/fn:k", "function", "file:d.ts", 1),
      ],
      [
        wire("extends", "file:b.py/cls:B", "file:a.py/cls:A"),
        wire("calls", "file:b.py/fn:g", "file:a.py/fn:f"),
        wire("calls", "file:a.py/fn:f", "file:b.py/fn:g"),
        wire("imports", "file:c.py", "file:a.py"),
        wire("imports", "file:b.py", "file:a.py"),
        wire("calls", "file:c.py/fn:h", "file:d.ts/fn:k", {
          label: "HTTP GET /api",
          labelKey: "name",
        }),
      ],
    ),
    project: { name: "p" },
  };
  const top = projectLevel(p, "dir:.");

  it("reaches across files and has one wire per pair of files", () => {
    expect(top.reach).toBe("across");
    const pairs = deps(top).map((e) => `${e.source}->${e.target}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("lets the call win over the inheritance and the import of the same pair", () => {
    const kinds = Object.fromEntries(
      deps(top).map((e) => [`${e.source}->${e.target}`, e.kind]),
    );
    expect(kinds["file:b.py->file:a.py"]).toBe("calls");
    expect(kinds["file:a.py->file:b.py"]).toBe("calls");
  });

  it("keeps an import that is the only link of its pair", () => {
    const only = deps(top).find(
      (e) => e.source === "file:c.py" && e.target === "file:a.py",
    );
    expect(only?.kind).toBe("imports");
  });

  it("keeps the label of a link between languages", () => {
    const link = deps(top).find((e) => e.target === "file:d.ts");
    expect(link).toMatchObject({ label: "HTTP GET /api", labelKey: "name" });
  });

  it("marks the two files that call each other as one wire and its wire back", () => {
    expect([...backWires(deps(top))]).toHaveLength(1);
  });

  it("shows inheritance and the call inside a file, grey, and none from other files", () => {
    const inside = projectLevel(p, "file:a.py");
    expect(inside.reach).toBe("inside");
    expect(deps(inside)).toEqual([]);
  });

  it("puts every wire of the level on sides that do not run behind a card", () => {
    const positions = layoutLR(top.nodes, top.edges);
    const sides = wireSides(top.edges, positions, { rows: false });
    for (const e of deps(top)) {
      const from = positions.get(e.source);
      const to = positions.get(e.target);
      if (!from || !to) throw new Error("missing");
      const forward = to.x >= from.x + NODE_WIDTH;
      // A wire that goes forward keeps the layout's sides; one that does not picks its own.
      expect(sides.has(e.id)).toBe(!forward || backWires(top.edges).has(e.id));
    }
  });
});

describe("cards the viewer moved", () => {
  it("makes a flow wire face its card, and keeps the others", () => {
    const edges = [wire("next", "a", "b"), wire("next", "c", "d")];
    const positions = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 0, y: 400 }],
      ["c", { x: 0, y: 0 }],
      ["d", { x: 400, y: 0 }],
    ]);
    const sides = wireSides(edges, positions, {
      rows: false,
      moved: new Set(["b"]),
    });
    expect(sides.get("next:a->b")).toEqual([Side.Bottom, Side.Top]);
    expect(sides.has("next:c->d")).toBe(false);
  });

  it("skips a wire with an end that has no position", () => {
    const sides = wireSides(
      [wire("calls", "a", "z")],
      new Map([["a", { x: 0, y: 0 }]]),
      {
        rows: true,
      },
    );
    expect(sides.size).toBe(0);
  });
});

describe("backWires on a ring of mutual pairs", () => {
  it("marks exactly one wire of each pair, whatever the kind", () => {
    const edges = [
      wire("calls", "a", "b"),
      wire("calls", "b", "a"),
      wire("extends", "c", "d"),
      wire("calls", "d", "c"),
      wire("imports", "e", "f"),
      wire("imports", "f", "e"),
    ];
    expect(backWires(edges).size).toBe(3);
  });
});
