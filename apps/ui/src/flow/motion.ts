import type { FlowEdge, FlowNode, NodeId } from "@8n8/model";
import type { Position } from "./layout";

/** Milliseconds from the moment a level appears (values from the video). */
const ENTER_STEP = 150;
/**
 * The last card of a level enters by this time, so with its fade a whole
 * level settles in about 1.5 s. A long level shortens the 150 ms step.
 */
const ENTER_SPAN = 1200;
/** Fade of a card (styles.css, node-in). A wire waits for it to end. */
const ENTER_FADE = 250;
const DRAW_DURATION = 500;
const PULSE_PAUSE = 300;
const PULSE_STEP = 1500;

export interface Schedule {
  enterAt: Map<NodeId, number>;
  /** By wire ID. */
  drawAt: Map<string, number>;
  /** By wire ID. */
  pulseAt: Map<string, number>;
}

/**
 * When each node enters, each wire draws and each pulse runs (VID-06). Nodes
 * enter 150 ms apart, or closer when the level is long, so the last one
 * enters by 1200 ms. A wire draws once both its ends have faded in. With `reduced`, every value is 0 (VID-07).
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
    edges.map((e) => [
      e.id,
      reduced ? 0 : Math.max(enter(e.source), enter(e.target)) + ENTER_FADE,
    ]),
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
