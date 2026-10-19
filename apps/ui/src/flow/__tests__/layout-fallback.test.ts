import type { FlowEdge, FlowNode } from "@8n8/model";
import { describe, expect, it, vi } from "vitest";
import {
  LAYOUT_MAX_NODES,
  layoutGrid,
  layoutLR,
  NODE_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
} from "../layout";

// dagre overflows the browser's stack on a long chain of calls: the same failure, on demand.
const fail = vi.hoisted(() => ({ now: false }));
vi.mock("@dagrejs/dagre", async (real) => {
  const dagre = await real<typeof import("@dagrejs/dagre")>();
  return {
    ...dagre,
    layout: (...args: Parameters<typeof dagre.layout>) => {
      if (fail.now) throw new RangeError("Maximum call stack size exceeded");
      return dagre.layout(...args);
    },
  };
});

const fn = (i: number): FlowNode => ({
  id: `f${i}`,
  kind: "function",
  label: `f${i}`,
  parentId: null,
  range: { start: i + 1, end: i + 1 },
  openable: true,
});
/** `f{i}` calls `f{i-1}`: the chain of the G13 case. */
function chain(n: number): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes = Array.from({ length: n }, (_, i) => fn(i));
  const edges = nodes.slice(1).map(
    (_, i): FlowEdge => ({
      id: `calls:f${i + 1}->f${i}`,
      kind: "calls",
      source: `f${i + 1}`,
      target: `f${i}`,
    }),
  );
  return { nodes, edges };
}

describe("layoutGrid", () => {
  it("lays the cards in code order, row after row, in a near-square grid", () => {
    const p = layoutGrid(Array.from({ length: 5 }, (_, i) => fn(i)));
    const step = { x: NODE_WIDTH + NODE_GAP, y: NODE_HEIGHT + NODE_GAP };
    expect([...p.values()]).toEqual([
      { x: 0, y: 0 },
      { x: step.x, y: 0 },
      { x: 2 * step.x, y: 0 },
      { x: 0, y: step.y },
      { x: step.x, y: step.y },
    ]);
  });
});

describe("layoutLR falls back to the grid (G13)", () => {
  it("skips dagre over LAYOUT_MAX_NODES: 3000 functions in a chain come back at once, each in its own place", () => {
    const { nodes, edges } = chain(3000);
    expect(nodes.length).toBeGreaterThan(LAYOUT_MAX_NODES);
    const started = Date.now();
    const p = layoutLR(nodes, edges);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(p).toEqual(layoutGrid(nodes));
    expect(new Set([...p.values()].map((q) => `${q.x},${q.y}`)).size).toBe(
      3000,
    );
  });

  it("gives the grid when dagre throws, instead of the error", () => {
    const { nodes, edges } = chain(4);
    fail.now = true;
    try {
      expect(layoutLR(nodes, edges)).toEqual(layoutGrid(nodes));
    } finally {
      fail.now = false;
    }
    expect(layoutLR(nodes, edges)).not.toEqual(layoutGrid(nodes));
  });
});
