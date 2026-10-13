import type { FlowEdge, FlowNode } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { layoutLR } from "../layout";

function node(id: string): FlowNode {
  return {
    id,
    kind: "code",
    label: id,
    parentId: null,
    range: { start: 1, end: 1 },
    openable: false,
  };
}

function edge(source: string, target: string): FlowEdge {
  return { id: `next:${source}->${target}`, kind: "next", source, target };
}

const nodes = ["a", "b", "c", "d"].map(node);
const edges = [edge("a", "b"), edge("b", "c"), edge("a", "d")];

describe("layoutLR", () => {
  it("gives every node numeric x and y", () => {
    const pos = layoutLR(nodes, edges);
    expect(pos.size).toBe(4);
    for (const n of nodes) {
      const p = pos.get(n.id);
      expect(Number.isFinite(p?.x)).toBe(true);
      expect(Number.isFinite(p?.y)).toBe(true);
    }
  });

  it("places the source of each wire left of its target", () => {
    const pos = layoutLR(nodes, edges);
    for (const e of edges) {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      expect(a && b && a.x < b.x).toBe(true);
    }
  });

  it("is deterministic", () => {
    expect(layoutLR(nodes, edges)).toEqual(layoutLR(nodes, edges));
  });

  it("returns an empty result for an empty list", () => {
    expect(layoutLR([], []).size).toBe(0);
  });
});
