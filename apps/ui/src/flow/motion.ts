import type { FlowEdge, FlowNode, NodeId } from "@8n8/model";
import type { Position } from "./layout";

/** Milliseconds from the moment a level appears (values from the video). */
const ENTER_STEP = 350;
/**
 * The last card of a level enters by this time, so with its 500 ms fade a
 * whole level settles in about 3 s. A long level shortens the 350 ms step.
 */
const ENTER_SPAN = 2500;
const DRAW_DELAY = 400;
const DRAW_DURATION = 500;
const PULSE_PAUSE = 300;
const PULSE_STEP = 750;

export interface Schedule {
  enterAt: Map<NodeId, number>;
  /** By wire ID. */
  drawAt: Map<string, number>;
  /** By wire ID. */
  pulseAt: Map<string, number>;
}

/**
 * When each node enters, each wire draws and each pulse runs (VID-06). Nodes
 * enter 350 ms apart, or closer when the level is long, so the last one
 * enters by 2500 ms. With `reduced`, every value is 0 (VID-07).
 */
export function schedule(
  nodes: FlowNode[],
  edges: FlowEdge[],
  positions: Map<NodeId, Position>,
  reduced: boolean,
): Schedule {
  const pos = (id: NodeId) => positions.get(id) ?? { x: 0, y: 0 };
  const order = [...nodes].sort(
    (a, b) => pos(a.id).x - pos(b.id).x || pos(a.id).y - pos(b.id).y,
  );
  const step = Math.min(ENTER_STEP, ENTER_SPAN / Math.max(1, order.length - 1));
  const enterAt = new Map<NodeId, number>(
    order.map((n, k) => [n.id, reduced ? 0 : k * step]),
  );
  const enter = (id: NodeId) => enterAt.get(id) ?? 0;
  const drawAt = new Map<string, number>(
    edges.map((e) => [e.id, reduced ? 0 : enter(e.source) + DRAW_DELAY]),
  );
  const t0 = Math.max(0, ...drawAt.values()) + DRAW_DURATION + PULSE_PAUSE;
  const flow = [...edges].sort(
    (a, b) =>
      enter(a.source) - enter(b.source) || enter(a.target) - enter(b.target),
  );
  const pulseAt = new Map<string, number>(
    flow.map((e, k) => [e.id, reduced ? 0 : t0 + k * PULSE_STEP]),
  );
  return { enterAt, drawAt, pulseAt };
}
