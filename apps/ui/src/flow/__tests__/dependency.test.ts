import type { EdgeKind, FlowEdge } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { backWires, isDependency, wireSides } from "../dependency";
import { Side } from "../sides";

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

describe("wireSides of a back wire", () => {
  // The root level of the 8n8 repo: e2e and playwright.config import each other, and e2e
  // also imports packages, below on the right; the root folder sits below on the left.
  const positions = new Map([
    ["dir:.", { x: -400, y: 220 }],
    ["dir:e2e", { x: 0, y: 0 }],
    ["file:playwright.config.ts", { x: 400, y: 0 }],
    ["dir:packages", { x: 400, y: 160 }],
  ]);
  const edges = [
    edge("contains", "dir:.", "dir:e2e"),
    edge("imports", "dir:e2e", "file:playwright.config.ts"),
    edge("imports", "file:playwright.config.ts", "dir:e2e"),
    edge("imports", "dir:e2e", "dir:packages"),
  ];

  it("runs above the two cards when their other wires go below, so it crosses none of them", () => {
    const sides = wireSides(edges, positions, { rows: false });
    expect(sides.get("imports:file:playwright.config.ts->dir:e2e")).toEqual([
      Side.Top,
      Side.Top,
    ]);
  });

  it("runs below when the other wires go above", () => {
    const up = new Map(positions);
    up.set("dir:.", { x: -400, y: -220 });
    up.set("dir:packages", { x: 400, y: -160 });
    const sides = wireSides(edges, up, { rows: false });
    expect(sides.get("imports:file:playwright.config.ts->dir:e2e")).toEqual([
      Side.Bottom,
      Side.Bottom,
    ]);
  });
});
