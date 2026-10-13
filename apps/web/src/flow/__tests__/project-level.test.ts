import type {
  EdgeKind,
  FlowEdge,
  FlowNode,
  Graph,
  NodeKind,
} from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { projectLevel } from "../project-level";

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

describe("projectLevel top level", () => {
  const g = graph(
    [
      node("mod", "module", null),
      node("mod/s0", "call", "mod", { target: "a" }),
      node("a", "function", null),
      node("a/s0", "call", "a", { target: "b" }),
      node("b", "function", null),
      node("K", "class", null),
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
  );
  const level = projectLevel(g, null);

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
