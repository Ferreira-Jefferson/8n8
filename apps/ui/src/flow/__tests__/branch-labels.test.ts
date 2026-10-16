import type { FlowEdge, FlowNode, Graph } from "@8n8/model";
import { describe, expect, it } from "vitest";
import {
  clearStraightWires,
  LABEL_BAND,
  LABEL_ROOM,
  layoutLR,
  NODE_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
  WIRE_CLEAR,
  widenGaps,
} from "../layout";
import { projectLevel } from "../project-level";
import { Side } from "../sides";
import { branchLabelAt } from "../WireEdge";

const STEP = NODE_WIDTH + NODE_GAP;

function edge(source: string, target: string, label?: string): FlowEdge {
  return {
    id: `${source}->${target}`,
    kind: label ? "branch" : "next",
    source,
    target,
    ...(label ? { label } : {}),
  };
}

const F = "fn:frete";
const step = (id: string, kind: FlowNode["kind"], line: number): FlowNode => ({
  id,
  kind,
  label: id,
  parentId: F,
  range: { start: line, end: line },
  openable: false,
});

/**
 * The graph the Python plugin gives for an `if` with no `else` that raises
 * (VID-21), by hand:
 *
 *     def frete(peso, distancia):
 *         if peso <= 0:
 *             raise ValueError("peso")
 *         return (10 + peso * 0.5) * (1.2 if distancia > 500 else 1.0)
 */
const RAISES: Graph = {
  language: "python",
  empty: false,
  nodes: [
    {
      id: F,
      kind: "function",
      label: "frete",
      parentId: null,
      range: { start: 1, end: 4 },
      openable: true,
    },
    step(`${F}/s0`, "condition", 2),
    step(`${F}/s0/b0/s0`, "external", 3),
    step(`${F}/s1`, "return", 4),
  ],
  edges: [
    edge(`${F}/s0`, `${F}/s0/b0/s0`, "true"),
    edge(`${F}/s0/b0/s0`, `${F}/s1`),
    edge(`${F}/s0`, `${F}/s1`, "false"),
  ],
};

describe("clearStraightWires (VID-21)", () => {
  it("moves a card of a skipped column off a straight wire, down when its middle is below", () => {
    const p = new Map([
      ["if", { x: 0, y: 0 }],
      ["raise", { x: STEP, y: 30 }],
      ["ret", { x: 2 * STEP, y: 0 }],
    ]);
    const out = clearStraightWires(p, [edge("if", "ret", "false")]);
    const line = NODE_HEIGHT / 2;
    expect(out.get("raise")).toEqual({ x: STEP, y: line + WIRE_CLEAR });
    expect(out.get("ret")).toEqual({ x: 2 * STEP, y: 0 });
  });

  it("moves it up when its middle is above, and pushes the cards beyond it to keep NODE_GAP", () => {
    const p = new Map([
      ["if", { x: 0, y: 0 }],
      ["top", { x: STEP, y: -200 }],
      ["mid", { x: STEP, y: -40 }],
      ["ret", { x: 2 * STEP, y: 0 }],
    ]);
    const out = clearStraightWires(p, [edge("if", "ret", "false")]);
    const line = NODE_HEIGHT / 2;
    const mid = out.get("mid")?.y ?? 0;
    expect(mid).toBe(line - WIRE_CLEAR - NODE_HEIGHT);
    expect(out.get("top")?.y).toBe(mid - NODE_GAP - NODE_HEIGHT);
  });

  it("leaves alone a card already clear of the wire, and wires between neighbour columns", () => {
    const p = new Map([
      ["if", { x: 0, y: 0 }],
      ["far", { x: STEP, y: 400 }],
      ["ret", { x: 2 * STEP, y: 0 }],
      ["next", { x: STEP, y: 0 }],
    ]);
    const out = clearStraightWires(p, [
      edge("if", "ret", "false"),
      edge("ret", "next"),
    ]);
    expect(out.get("far")).toEqual({ x: STEP, y: 400 });
  });

  it("frees the straight false wire of an if that raises: no card covers it", () => {
    const level = projectLevel(RAISES, F);
    const at = layoutLR(level.nodes, level.edges, F);
    const yes = level.edges.find((e) => e.label === "true");
    const no = level.edges.find((e) => e.label === "false");
    const s = at.get(no?.source ?? "");
    const t = at.get(no?.target ?? "");
    expect(s && t && s.y === t.y).toBe(true);
    const line = (s?.y ?? 0) + NODE_HEIGHT / 2;
    const raise = at.get(yes?.target ?? "");
    expect(raise?.y ?? 0).toBeGreaterThanOrEqual(line + WIRE_CLEAR);
  });
});

describe("widenGaps with branch labels (VID-21)", () => {
  it("widens the gap before a labelled card to LABEL_ROOM when a card of the column before sits at the label's height", () => {
    // A straight branch: the label stands above the port of "next", where "if" is.
    const p = new Map([
      ["if", { x: 0, y: 0 }],
      ["next", { x: STEP, y: 0 }],
    ]);
    const out = widenGaps(p, [edge("if", "next", "true")]);
    expect(out.get("next")?.x).toBe(NODE_WIDTH + LABEL_ROOM);
  });

  it("keeps NODE_GAP when the column before leaves the label's height free", () => {
    // The wire comes up into "up": its label stands above the port, clear of "if".
    // The port of "up" sits LABEL_BAND + 1 above the top of "if".
    const port = -LABEL_BAND - 1;
    const p = new Map([
      ["if", { x: 0, y: 0 }],
      ["up", { x: STEP, y: port - NODE_HEIGHT / 2 }],
      ["down", { x: STEP, y: NODE_HEIGHT + LABEL_BAND + 1 }],
    ]);
    const out = widenGaps(p, [
      edge("if", "up", "true"),
      edge("if", "down", "false"),
    ]);
    expect(out.get("up")?.x).toBe(STEP);
  });
});

/** Where each branch label of `graph`'s level `level` stands, as the canvas draws it. */
function labelSpots(graph: Graph, level: string) {
  const lv = projectLevel(graph, level);
  const positions = layoutLR(lv.nodes, lv.edges, level);
  return lv.edges
    .filter((e) => e.label)
    .map((e) => {
      const s = positions.get(e.source) ?? { x: 0, y: 0 };
      const t = positions.get(e.target) ?? { x: 0, y: 0 };
      return {
        label: e.label,
        target: t,
        spot: branchLabelAt(
          t.x,
          t.y + NODE_HEIGHT / 2,
          s.y + NODE_HEIGHT / 2,
          Side.Left,
        ),
      };
    });
}

describe("branch label of a wire that turns into a later band", () => {
  it("sits above the top-left corner of its card, never left of the card, where the wire comes down", () => {
    // turnPath: the wire comes down 24 px left of the port, often at the canvas edge.
    const spot = branchLabelAt(50, 700, 300, Side.Left, true);
    expect(spot).toEqual({
      x: 54,
      y: 700 - NODE_HEIGHT / 2 - 4,
      above: true,
      leftward: false,
    });
  });

  it("keeps the label by the port when the wire does not turn", () => {
    expect(branchLabelAt(50, 700, 300, Side.Left).leftward).toBe(true);
  });
});

describe("branch labels of an if that raises (VID-21)", () => {
  it("stand each by the port of its own card: true by ValueError, false by the return", () => {
    const spots = labelSpots(RAISES, F);
    for (const { target, spot } of spots) {
      expect(spot.x).toBe(target.x - 8);
      expect(Math.abs(spot.y - (target.y + NODE_HEIGHT / 2))).toBe(4);
    }
    const byLabel = new Map(spots.map((s) => [s.label, s]));
    expect(byLabel.get("true")?.spot.x).not.toBe(byLabel.get("false")?.spot.x);
  });

  it("put false above the straight wire and true below the end of the wire that comes down", () => {
    const byLabel = new Map(
      labelSpots(RAISES, F).map((s) => [s.label, s.spot]),
    );
    expect(byLabel.get("false")?.above).toBe(true);
    expect(byLabel.get("true")?.above).toBe(false);
  });
});
