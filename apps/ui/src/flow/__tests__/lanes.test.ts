import type { FlowEdge } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { wireLanes } from "../lanes";
import {
  LANE_GAP,
  NODE_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
  widenGaps,
} from "../layout";
import { lanePath } from "../WireEdge";

function edge(source: string, target: string): FlowEdge {
  return { id: `${source}->${target}`, kind: "next", source, target };
}

const STEP = NODE_WIDTH + NODE_GAP;

describe("wireLanes", () => {
  const positions = new Map([
    ["a", { x: 0, y: 0 }],
    ["b", { x: 0, y: 300 }],
    ["c", { x: STEP, y: 150 }],
    ["d", { x: STEP, y: 450 }],
  ]);
  const edges = [edge("a", "c"), edge("b", "c"), edge("a", "d")];

  it("gives each wire that shares a gap its own x, inside the gap", () => {
    const lanes = wireLanes(edges, positions);
    const xs = [...lanes.values()];
    expect(lanes.size).toBe(3);
    expect(new Set(xs).size).toBe(3);
    for (const x of xs) {
      expect(x).toBeGreaterThan(NODE_WIDTH);
      expect(x).toBeLessThan(STEP);
    }
  });

  it("leaves a wire that has the gap to itself, and a straight wire, alone", () => {
    const solo = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: STEP, y: 200 }],
      ["c", { x: 0, y: 700 }],
      ["d", { x: STEP, y: 700 }],
    ]);
    expect(wireLanes([edge("a", "b"), edge("c", "d")], solo).size).toBe(0);
  });

  it("skips wires it is told to skip", () => {
    expect(wireLanes(edges, positions, new Set(["a->c"])).size).toBe(2);
  });

  it("does not lane a wire that goes backwards", () => {
    const back = new Map([
      ["a", { x: STEP, y: 0 }],
      ["b", { x: 0, y: 200 }],
    ]);
    expect(wireLanes([edge("a", "b")], back).size).toBe(0);
  });
});

describe("widenGaps", () => {
  it("keeps NODE_GAP when few wires change height", () => {
    const p = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: STEP, y: 200 }],
    ]);
    expect(widenGaps(p, [edge("a", "b")]).get("b")?.x).toBe(STEP);
  });

  it("grows a gap to LANE_GAP per wire that changes height", () => {
    const p = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 0, y: 200 }],
      ["c", { x: 0, y: 400 }],
      ["d", { x: 0, y: 600 }],
      ["e", { x: STEP, y: 100 }],
      ["f", { x: STEP, y: 500 }],
      ["g", { x: 2 * STEP, y: 0 }],
    ]);
    const edges = [
      edge("a", "e"),
      edge("b", "e"),
      edge("c", "f"),
      edge("d", "f"),
      edge("e", "g"),
    ];
    const out = widenGaps(p, edges);
    expect(out.get("e")?.x).toBe(NODE_WIDTH + 5 * LANE_GAP);
    expect(out.get("a")?.x).toBe(0);
    expect(out.get("g")?.y).toBe(0);
  });
});

describe("lanePath", () => {
  it("runs out of the source, down at the lane, and into the target", () => {
    expect(lanePath(0, 0, 400, 200, 200)).toBe(
      "M 0 0 H 180 Q 200 0, 200 20 V 180 Q 200 200, 220 200 H 400",
    );
  });

  it("goes up when the target is higher", () => {
    expect(lanePath(0, 200, 400, 0, 200)).toContain("V 20");
  });

  it("stays a plain line pair when the rise is tiny", () => {
    expect(lanePath(0, 0, 400, 4, 200)).toContain("V 2");
  });
});

describe("card geometry used by lanes", () => {
  it("is 320 by 140", () => {
    expect([NODE_WIDTH, NODE_HEIGHT]).toEqual([320, 140]);
  });
});
