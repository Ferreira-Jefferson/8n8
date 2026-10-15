import type { FlowEdge, FlowNode } from "@8n8/model";
import { describe, expect, it } from "vitest";
import {
  BAND_GAP,
  layoutLR,
  layoutRows,
  NODE_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
  orderBranches,
  ROW_GAP,
  rowBands,
  wrapColumns,
  wrapRows,
  ZIGZAG,
} from "../layout";
import { projectLevel } from "../project-level";
import { videoGraph } from "./video-graph";

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

describe("VID-03: card size", () => {
  it("cards are 320 by 140 with a gap of 60", () => {
    expect([NODE_WIDTH, NODE_HEIGHT, NODE_GAP, ROW_GAP]).toEqual([
      320, 140, 60, 80,
    ]);
  });
});

describe("VID-10, 11: layoutRows", () => {
  it("places node i of row r at x = i * 380 and y = r * 310, odd nodes 90 px higher", () => {
    const pos = layoutRows([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
    expect(ZIGZAG).toBe(90);
    expect(Object.fromEntries(pos)).toEqual({
      a: { x: 0, y: 0 },
      b: { x: 380, y: -90 },
      c: { x: 760, y: 0 },
      d: { x: 0, y: 310 },
      e: { x: 380, y: 220 },
    });
  });

  it("keeps the rows apart: the highest card of a row is below the lowest card of the row above", () => {
    const pos = layoutRows([
      ["a", "b"],
      ["c", "d"],
    ]);
    const lowestOfFirst = Math.max(pos.get("a")?.y ?? 0, pos.get("b")?.y ?? 0);
    const highestOfSecond = Math.min(
      pos.get("c")?.y ?? 0,
      pos.get("d")?.y ?? 0,
    );
    expect(highestOfSecond - (lowestOfFirst + NODE_HEIGHT)).toBe(ROW_GAP);
  });

  it("returns an empty result for no rows", () => {
    expect(layoutRows([]).size).toBe(0);
  });
});

describe("VID-10: wrapRows", () => {
  it("cuts each row into rows of at most perRow nodes, in order", () => {
    const eight = ["t", "a", "b", "c", "d", "e", "f", "g"];
    expect(wrapRows([eight], 4)).toEqual([
      ["t", "a", "b", "c"],
      ["d", "e", "f", "g"],
    ]);
    expect(wrapRows([eight], 3)).toEqual([
      ["t", "a", "b"],
      ["c", "d", "e"],
      ["f", "g"],
    ]);
  });

  it("wraps each entry on its own: a new entry always starts a new row", () => {
    expect(wrapRows([["t", "a", "b"], ["u"]], 2)).toEqual([
      ["t", "a"],
      ["b"],
      ["u"],
    ]);
  });

  it("keeps a row that already fits, and treats perRow below 1 as 1", () => {
    expect(wrapRows([["t", "a"]], 5)).toEqual([["t", "a"]]);
    expect(wrapRows([["t", "a"]], 0)).toEqual([["t"], ["a"]]);
  });

  it("puts the wrapped part at x = 0 of the next row, still zigzagging", () => {
    const pos = layoutRows(wrapRows([["t", "a", "b", "c"]], 2));
    expect(Object.fromEntries(pos)).toEqual({
      t: { x: 0, y: 0 },
      a: { x: 380, y: -90 },
      b: { x: 0, y: 310 },
      c: { x: 380, y: 220 },
    });
  });
});

describe("VID-10: rowBands", () => {
  it("numbers the rows and turns in the gap half a ROW_GAP above the raised cards", () => {
    const b = rowBands([
      ["t", "a"],
      ["b", "c"],
    ]);
    expect(Object.fromEntries(b.band)).toEqual({ t: 0, a: 0, b: 1, c: 1 });
    // Row 0 ends at 140; row 1 starts at 310 - 90 = 220: the middle is 180.
    expect(b.gapAbove).toEqual([-130, 180]);
  });
});

describe("VID-23: wrapColumns", () => {
  const P = "fn:processar_pedido";
  const C = "fn:calcular_frete";
  const lrOf = (id: string) => {
    const level = projectLevel(videoGraph, id);
    return layoutLR(level.nodes, level.edges, id);
  };

  it("keeps the layout when one band holds every column", () => {
    const lr = lrOf(C);
    const b = wrapColumns(lr, 4);
    expect(b.positions).toEqual(lr);
    expect(new Set(b.band.values())).toEqual(new Set([0]));
  });

  it("cuts the 8 steps of processar_pedido into bands of 3, 3 and 2, each starting at the left", () => {
    const lr = lrOf(P);
    const b = wrapColumns(lr, 3);
    const xs = [0, 1, 2, 3, 4, 5, 6, 7].map(
      (i) => b.positions.get(`${P}/s${i}`)?.x,
    );
    const x0 = lr.get(`${P}/s0`)?.x ?? 0;
    const step = NODE_WIDTH + NODE_GAP;
    expect(xs).toEqual([0, 1, 2, 0, 1, 2, 0, 1].map((c) => x0 + c * step));
    expect([0, 3, 6].map((i) => b.band.get(`${P}/s${i}`))).toEqual([0, 1, 2]);
  });

  it("stacks the bands BAND_GAP apart and turns in the middle of each gap", () => {
    const lr = lrOf(P);
    const b = wrapColumns(lr, 3);
    const y = (i: number) => b.positions.get(`${P}/s${i}`)?.y ?? 0;
    expect(y(3) - (y(0) + NODE_HEIGHT)).toBe(BAND_GAP);
    expect(b.gapAbove[1]).toBe(y(3) - BAND_GAP / 2);
    expect(b.gapAbove[2]).toBe(y(6) - BAND_GAP / 2);
  });

  it("keeps the yes branch above the no branch inside a band", () => {
    const lr = lrOf(C);
    const b = wrapColumns(lr, 3);
    const yes = b.positions.get(`${C}/s2/b0/s0`);
    const no = b.positions.get(`${C}/s2/b1/s0`);
    expect(yes && no && yes.x === no.x && yes.y < no.y).toBe(true);
    expect(b.band.get(`${C}/s2/b0/s0`)).toBe(1);
    // The band below starts under the lowest card of the band above.
    const se = b.positions.get(`${C}/s2`)?.y ?? 0;
    expect((yes?.y ?? 0) - (se + NODE_HEIGHT)).toBe(BAND_GAP);
  });
});

function stepNode(id: string): FlowNode {
  return { ...node(id), parentId: "f" };
}

function branch(source: string, target: string, label: string): FlowEdge {
  return {
    id: `branch:${source}->${target}`,
    kind: "branch",
    source,
    target,
    label,
  };
}

describe("VID-21: the yes branch on top", () => {
  it("puts b0/s0 above b1/s0 in calcular_frete of the video", () => {
    const C = "fn:calcular_frete";
    const level = projectLevel(videoGraph, C);
    const pos = layoutLR(level.nodes, level.edges, C);
    const yes = pos.get(`${C}/s2/b0/s0`);
    const no = pos.get(`${C}/s2/b1/s0`);
    expect(yes && no && yes.x === no.x).toBe(true);
    expect(yes && no && yes.y < no.y).toBe(true);
  });

  it("puts b0 above b1 even when the não wire comes first", () => {
    const nodes = ["f/s0", "f/s0/b1/s0", "f/s0/b0/s0"].map(stepNode);
    const edges = [
      branch("f/s0", "f/s0/b1/s0", "não"),
      branch("f/s0", "f/s0/b0/s0", "sim"),
    ];
    const pos = layoutLR(nodes, edges, "f");
    const yes = pos.get("f/s0/b0/s0");
    const no = pos.get("f/s0/b1/s0");
    expect(yes && no && yes.y < no.y).toBe(true);
  });

  it("orderBranches swaps a no branch drawn above the yes branch", () => {
    const nodes = ["f/s2", "f/s2/b0/s0", "f/s2/b1/s0"].map(stepNode);
    const pos = new Map([
      ["f/s2", { x: 0, y: 100 }],
      ["f/s2/b1/s0", { x: 380, y: 0 }],
      ["f/s2/b0/s0", { x: 380, y: 200 }],
    ]);
    const out = orderBranches(pos, nodes, "f");
    expect(out.get("f/s2/b0/s0")).toEqual({ x: 380, y: 0 });
    expect(out.get("f/s2/b1/s0")).toEqual({ x: 380, y: 200 });
    expect(out.get("f/s2")).toEqual({ x: 0, y: 100 });
  });

  it("orders elif branches b0 < b1 < b2", () => {
    const ids = ["f/s0/b2/s0", "f/s0/b0/s0", "f/s0/b1/s0"];
    const pos = new Map(ids.map((id, i) => [id, { x: 380, y: i * 200 }]));
    const out = orderBranches(pos, ids.map(stepNode), "f");
    expect(ids.map((id) => out.get(id)?.y)).toEqual([400, 0, 200]);
  });

  it("orders the branches of a nested if, and a plain step sits between yes and no", () => {
    const ids = ["f/s0/b0/s0/b1/s0", "f/s0/b1/s0", "f/s1", "f/s0/b0/s0/b0/s0"];
    const pos = new Map(ids.map((id, i) => [id, { x: 760, y: i * 200 }]));
    const out = orderBranches(pos, ids.map(stepNode), "f");
    expect(out.get("f/s0/b0/s0/b0/s0")?.y).toBe(0);
    expect(out.get("f/s0/b0/s0/b1/s0")?.y).toBe(200);
    expect(out.get("f/s1")?.y).toBe(400);
    expect(out.get("f/s0/b1/s0")?.y).toBe(600);
  });

  it("keeps the dagre order on a tie and leaves other columns alone", () => {
    const ids = ["f/s3", "f/s1", "f/s2"];
    const pos = new Map([
      ["f/s3", { x: 0, y: 0 }],
      ["f/s1", { x: 0, y: 200 }],
      ["f/s2", { x: 380, y: 50 }],
    ]);
    const out = orderBranches(pos, ids.map(stepNode), "f");
    expect(Object.fromEntries(out)).toEqual(Object.fromEntries(pos));
  });
});
