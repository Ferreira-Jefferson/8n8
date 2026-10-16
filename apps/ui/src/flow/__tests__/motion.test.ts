import type { FlowEdge, FlowNode } from "@8n8/model";
import { describe, expect, it } from "vitest";
import type { Position } from "../layout";
import { schedule } from "../motion";

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

function at(entries: [string, number, number][]): Map<string, Position> {
  return new Map(entries.map(([id, x, y]) => [id, { x, y }]));
}

describe("VID-06: schedule", () => {
  it("nodes enter left to right, 150 ms apart", () => {
    const s = schedule(
      ["c", "a", "b"].map(node),
      [],
      at([
        ["a", 0, 0],
        ["b", 380, 0],
        ["c", 760, 0],
      ]),
      false,
    );
    expect(Object.fromEntries(s.enterAt)).toEqual({ a: 0, b: 150, c: 300 });
  });

  it("keeps 150 ms between the 8 cards of the video row", () => {
    const ids = Array.from({ length: 8 }, (_, i) => `n${i}`);
    const s = schedule(
      ids.map(node),
      [],
      at(ids.map((id, i) => [id, i * 380, 0])),
      false,
    );
    expect(s.enterAt.get("n7")).toBe(7 * 150);
  });

  it("compresses the stagger of a long level so its last card enters at 1200 ms", () => {
    const ids = Array.from({ length: 41 }, (_, i) => `n${i}`);
    const s = schedule(
      ids.map(node),
      [],
      at(ids.map((id, i) => [id, i * 380, 0])),
      false,
    );
    expect(s.enterAt.get("n0")).toBe(0);
    expect(s.enterAt.get("n1")).toBe(30);
    // The card fades in for 250 ms (styles.css, node-in).
    expect(s.enterAt.get("n40")).toBe(1200);
  });

  it("a tie in x goes by y", () => {
    const s = schedule(
      ["low", "high"].map(node),
      [],
      at([
        ["low", 380, 200],
        ["high", 380, 0],
      ]),
      false,
    );
    expect(Object.fromEntries(s.enterAt)).toEqual({ high: 0, low: 150 });
  });

  it("a wire starts drawing 250 ms after both its ends enter", () => {
    const s = schedule(
      ["a", "b", "c"].map(node),
      [edge("a", "b"), edge("b", "c")],
      at([
        ["a", 0, 0],
        ["b", 380, 0],
        ["c", 760, 0],
      ]),
      false,
    );
    expect(Object.fromEntries(s.drawAt)).toEqual({
      "next:a->b": 400,
      "next:b->c": 550,
    });
  });

  it("pulses go once per wire in flow order, from max(drawAt) + 800, 1500 ms apart", () => {
    const nodes = ["a", "b", "c", "d"].map(node);
    // Listed out of flow order on purpose.
    const edges = [edge("b", "d"), edge("a", "c"), edge("a", "b")];
    const s = schedule(
      nodes,
      edges,
      at([
        ["a", 0, 0],
        ["b", 380, 0],
        ["c", 380, 220],
        ["d", 760, 0],
      ]),
      false,
    );
    // enterAt: a 0, b 150, c 300, d 450. drawAt max = b->d = 450 + 250 = 700.
    const t0 = 700 + 800;
    expect(Object.fromEntries(s.pulseAt)).toEqual({
      "next:a->b": t0,
      "next:a->c": t0 + 1500,
      "next:b->d": t0 + 3000,
    });
    expect(s.pulseAt.size).toBe(edges.length);
  });
});

describe("VID-07: reduced motion", () => {
  it("gives 0 to every value", () => {
    const s = schedule(
      ["a", "b"].map(node),
      [edge("a", "b")],
      at([
        ["a", 0, 0],
        ["b", 380, 0],
      ]),
      true,
    );
    expect(Object.fromEntries(s.enterAt)).toEqual({ a: 0, b: 0 });
    expect(Object.fromEntries(s.drawAt)).toEqual({ "next:a->b": 0 });
    expect(Object.fromEntries(s.pulseAt)).toEqual({ "next:a->b": 0 });
  });
});
