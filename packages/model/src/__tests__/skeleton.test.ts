import { describe, expect, it } from "vitest";
import { hasCommands } from "../commands";
import type { FlowEdge, FlowNode, Graph } from "../graph";
import { skeletonGraphOf } from "../skeleton";

const node = (
  id: string,
  kind: FlowNode["kind"],
  parentId: string | null,
  extra: Partial<FlowNode> = {},
): FlowNode => ({
  id,
  kind,
  label: id,
  parentId,
  range: { start: 1, end: 3 },
  openable: true,
  ...extra,
});
const edge = (
  kind: FlowEdge["kind"],
  source: string,
  target: string,
  extra: Partial<FlowEdge> = {},
): FlowEdge => ({
  id: `${kind}:${source}->${target}`,
  kind,
  source,
  target,
  ...extra,
});

const graph: Graph = {
  language: "mixed",
  empty: false,
  project: { name: "p" },
  nodes: [
    node("dir:.", "folder", null, { path: "" }),
    node("file:a.py", "file", "dir:.", { path: "a.py" }),
    node("file:a.py/mod", "module", "file:a.py"),
    node("file:a.py/mod/s1", "code", "file:a.py/mod"),
    node("file:a.py/fn:f", "function", "file:a.py"),
    node("file:a.py/fn:g", "function", "file:a.py"),
    node("file:b.ts", "file", "dir:.", { path: "b.ts" }),
    node("file:b.ts/fn:h", "function", "file:b.ts"),
    node("file:b.ts/fn:k", "function", "file:b.ts"),
    node("file:c.py", "file", "dir:.", { path: "c.py" }),
  ],
  edges: [
    edge("imports", "file:a.py", "file:b.ts"),
    edge("calls", "file:a.py/fn:f", "file:a.py/fn:g"),
    edge("calls", "file:a.py/fn:g", "file:b.ts/fn:h", { label: "primeira" }),
    edge("calls", "file:a.py/fn:f", "file:b.ts/fn:k", { label: "segunda" }),
    edge("extends", "file:b.ts/fn:k", "file:a.py/fn:f", { labelKey: "name" }),
    edge("calls", "file:b.ts/fn:h", "file:b.ts/fn:k"),
  ],
};

describe("skeletonGraphOf", () => {
  const skeleton = skeletonGraphOf(graph);

  it("keeps only the folders and the files, in the order of the graph", () => {
    expect(skeleton.nodes.map((n) => n.id)).toEqual([
      "dir:.",
      "file:a.py",
      "file:b.ts",
      "file:c.py",
    ]);
    expect(skeleton.project).toEqual({ name: "p" });
    expect(skeleton.language).toBe("mixed");
  });

  it("sizes each file by what its level shows: loose code with no call stays out", () => {
    const size = (id: string) => skeleton.nodes.find((n) => n.id === id)?.size;
    expect(size("file:a.py")).toBe(2);
    expect(size("file:b.ts")).toBe(2);
    expect(size("file:c.py")).toBe(0);
    expect(skeleton.nodes[0]?.size).toBeUndefined();
  });

  it("opens only a file that has something inside, even if its level shows none", () => {
    const open = (id: string) =>
      skeleton.nodes.find((n) => n.id === id)?.openable;
    expect(open("file:a.py")).toBe(true);
    expect(open("file:c.py")).toBe(false);
  });

  it("keeps every import and one wire per pair of files and kind, with the label of the first wire", () => {
    expect(skeleton.edges).toEqual([
      edge("imports", "file:a.py", "file:b.ts"),
      edge("calls", "file:a.py", "file:b.ts", { label: "primeira" }),
      edge("extends", "file:b.ts", "file:a.py", { labelKey: "name" }),
    ]);
  });

  it("keeps a joined wire to check when any of its wires is to check, and counts the proven links and the ones to check", () => {
    const toCheck = {
      reason: "dynamic-base" as const,
      code: "config.baseUrl",
      path: "a.py",
      line: 4,
    };
    const link = (from: string, to: string, extra: Partial<FlowEdge> = {}) => ({
      ...edge("calls", from, to, extra),
      id: `link:http:${from}->${to}`,
    });
    const joined = skeletonGraphOf({
      ...graph,
      edges: [
        edge("calls", "file:a.py/fn:g", "file:b.ts/fn:h"),
        link("file:a.py/fn:g", "file:b.ts/fn:k", { label: "HTTP GET /a" }),
        link("file:a.py/fn:f", "file:b.ts/fn:k", { toCheck }),
      ],
    });
    expect(joined.edges).toEqual([
      edge("calls", "file:a.py", "file:b.ts", {
        toCheck,
        links: { proven: 1, toCheck: 1 },
      }),
    ]);
  });

  it("does not count a call that is no link", () => {
    const joined = skeletonGraphOf({
      ...graph,
      edges: [edge("calls", "file:a.py/fn:g", "file:b.ts/fn:h")],
    });
    expect(joined.edges[0]?.links).toBeUndefined();
  });

  it("drops a wire inside one file and a wire with an end in no file", () => {
    const loose = skeletonGraphOf({
      ...graph,
      edges: [
        edge("calls", "file:a.py/fn:f", "file:a.py/fn:g"),
        edge("calls", "file:a.py/fn:f", "nowhere"),
      ],
    });
    expect(loose.edges).toEqual([]);
  });

  it("does not change the graph it reads", () => {
    expect(graph.nodes.find((n) => n.id === "file:a.py")?.size).toBeUndefined();
    expect(graph.nodes).toHaveLength(10);
  });
});

describe("hasCommands", () => {
  it("is true for loose code with a call step and false for one that only sets names", () => {
    const owner = node("m", "module", null);
    expect(hasCommands([owner, node("m/s1", "code", "m")], "m")).toBe(false);
    expect(
      hasCommands([owner, node("m/s1", "call", "m", { target: "x" })], "m"),
    ).toBe(true);
  });

  it("looks inside a loop, a block or a condition", () => {
    const nodes = [
      node("m", "module", null),
      node("m/s1", "loop", "m"),
      node("m/s1/s1", "external", "m/s1", { callee: "x" }),
    ];
    expect(hasCommands(nodes, "m")).toBe(true);
  });
});
