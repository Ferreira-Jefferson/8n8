import type { FlowEdge, FlowNode, NodeId } from "@code2n8n/model";
import type { Position } from "./layout";

/** Milliseconds from the moment a level appears (values from the video). */
const ENTER_STEP = 350;
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
 * When each node enters, each wire draws and each pulse runs (VID-06). With
 * `reduced`, every value is 0 (VID-07).
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
  const enterAt = new Map<NodeId, number>(
    order.map((n, k) => [n.id, reduced ? 0 : k * ENTER_STEP]),
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
