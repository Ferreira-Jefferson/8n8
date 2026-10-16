import type { EdgeKind, FlowEdge } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { backWires, isDependency } from "../dependency";

const edge = (kind: EdgeKind, source: string, target: string): FlowEdge => ({
  id: `${kind}:${source}->${target}`,
  kind,
  source,
  target,
});

describe("isDependency", () => {
  it("is true for calls, extends and imports, and false for the rest", () => {
    for (const kind of ["calls", "extends", "imports"] as const) {
      expect(isDependency(kind)).toBe(true);
    }
    for (const kind of ["next", "branch", "contains"] as const) {
      expect(isDependency(kind)).toBe(false);
    }
  });
});

describe("backWires", () => {
  it("picks the second of two wires that run against each other, in ID order", () => {
    const edges = [edge("calls", "a", "b"), edge("calls", "b", "a")];
    expect([...backWires(edges)]).toEqual(["calls:b->a"]);
  });

  it("pairs wires of different kinds between the same two nodes", () => {
    const edges = [edge("extends", "a", "b"), edge("calls", "b", "a")];
    expect([...backWires(edges)]).toEqual(["extends:a->b"]);
  });

  it("leaves a single wire, a self loop and a flow wire alone", () => {
    const edges = [
      edge("calls", "a", "b"),
      edge("calls", "c", "c"),
      edge("next", "d", "e"),
      edge("next", "e", "d"),
    ];
    expect(backWires(edges).size).toBe(0);
  });
});
