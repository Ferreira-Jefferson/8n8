import type { FlowEdge, FlowNode, NodeId } from "@8n8/model";
import { Graph, layout } from "@dagrejs/dagre";

export const NODE_WIDTH = 320;
export const NODE_HEIGHT = 140;
export const NODE_GAP = 60;
export const ROW_GAP = 80;
/** Odd cards of a main-flow row sit this much higher, like the video's 470/380 (VID-10). */
export const ZIGZAG = 90;
/** Space between the vertical runs of two wires that share a gap. */
export const LANE_GAP = 20;
/** The width of a gap before a card a branch label stands by: "FALSE" is about 70 px wide, 8 px from the port (VID-21). */
export const LABEL_ROOM = 110;
/** A branch label fills this far above or below the line of its port: 4 px of space and a 22 px line of text. */
export const LABEL_BAND = 30;
/** A straight wire keeps this much room above and below it free of cards, so it never runs behind one. */
export const WIRE_CLEAR = 40;

export interface Position {
  x: number;
  y: number;
}

/** Left-to-right layout; returns the top-left position of each node. */
export function layoutLR(
  nodes: FlowNode[],
  edges: FlowEdge[],
  containerId: NodeId | null = null,
): Map<NodeId, Position> {
  const g = new Graph();
  g.setGraph({ rankdir: "LR", nodesep: NODE_GAP, ranksep: NODE_GAP });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes)
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) g.setEdge(e.source, e.target);
  layout(g);
  const out = new Map<NodeId, Position>();
  for (const n of nodes) {
    const p = g.node(n.id);
    out.set(n.id, { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 });
  }
  return widenGaps(
    clearStraightWires(orderBranches(out, nodes, containerId), edges),
    edges,
  );
}

/**
 * Widens each gap between two columns so every wire that changes height in
 * it gets a lane `LANE_GAP` apart, and a gap before a card a branch label
 * stands by gets `LABEL_ROOM` when a card of the column before sits at the
 * label's height, so a label never runs into a card (VID-21). A gap keeps
 * `NODE_GAP` when that is enough.
 */
export function widenGaps(
  positions: Map<NodeId, Position>,
  edges: FlowEdge[],
): Map<NodeId, Position> {
  const xs = [...new Set([...positions.values()].map((p) => p.x))].sort(
    (a, b) => a - b,
  );
  const column = new Map(xs.map((x, i) => [x, i]));
  const crossing = xs.map(() => 0);
  // The spans of the branch labels, by the column of the card each stands by:
  // above the port of a wire that comes up or straight, below one that comes down.
  const labels = xs.map(() => [] as { top: number; bottom: number }[]);
  for (const e of edges) {
    const s = positions.get(e.source);
    const t = positions.get(e.target);
    if (!s || !t) continue;
    const from = column.get(s.x) ?? 0;
    if (e.label) {
      const port = t.y + NODE_HEIGHT / 2;
      labels[column.get(t.x) ?? 0]?.push(
        s.y >= t.y
          ? { top: port - LABEL_BAND, bottom: port }
          : { top: port, bottom: port + LABEL_BAND },
      );
    }
    if (s.y === t.y) continue;
    const to = column.get(t.x) ?? 0;
    for (let g = from; g < to; g++) crossing[g] = (crossing[g] ?? 0) + 1;
  }
  // A label reaches past NODE_GAP only into a card of the column before at its height.
  const crowded = (i: number) =>
    (labels[i + 1] ?? []).some((l) =>
      [...positions.values()].some(
        (p) => p.x === xs[i] && p.y < l.bottom && p.y + NODE_HEIGHT > l.top,
      ),
    );
  const shift = new Map<number, number>();
  let total = 0;
  xs.forEach((x, i) => {
    shift.set(x, total);
    const wires = crossing[i] ?? 0;
    total += Math.max(
      0,
      (wires + 1) * LANE_GAP - NODE_GAP,
      crowded(i) ? LABEL_ROOM - NODE_GAP : 0,
    );
  });
  const out = new Map<NodeId, Position>();
  for (const [id, p] of positions) {
    out.set(id, { x: p.x + (shift.get(p.x) ?? 0), y: p.y });
  }
  return out;
}

/**
 * A straight wire that skips columns, like the "false" branch of an `if`
 * with no `else`, never runs behind a card: a card of a skipped column that
 * comes within `WIRE_CLEAR` of the wire moves away from it, down when its
 * middle is below the wire, up otherwise, and pushes the cards beyond it in
 * its column so they keep `NODE_GAP` (VID-21).
 */
export function clearStraightWires(
  positions: Map<NodeId, Position>,
  edges: FlowEdge[],
): Map<NodeId, Position> {
  const out = new Map(positions);
  for (const e of edges) {
    const s = out.get(e.source);
    const t = out.get(e.target);
    if (!s || !t || s.y !== t.y || t.x <= s.x) continue;
    const line = s.y + NODE_HEIGHT / 2;
    for (const [id, p] of [...out]) {
      if (p.x <= s.x || p.x >= t.x) continue;
      const near =
        p.y < line + WIRE_CLEAR && p.y + NODE_HEIGHT > line - WIRE_CLEAR;
      if (!near) continue;
      const down = p.y + NODE_HEIGHT / 2 >= line;
      out.set(id, {
        x: p.x,
        y: down ? line + WIRE_CLEAR : line - WIRE_CLEAR - NODE_HEIGHT,
      });
      keepColumnGaps(out, id, p.y, down);
    }
  }
  return out;
}

/** After `moved` left `from`, pushes the cards beyond it in its column, in the same direction, so each keeps `NODE_GAP`. */
function keepColumnGaps(
  positions: Map<NodeId, Position>,
  moved: NodeId,
  from: number,
  down: boolean,
): void {
  const m = positions.get(moved);
  if (!m) return;
  const beyond = [...positions]
    .filter(([id, p]) => id !== moved && p.x === m.x)
    .filter(([, p]) => (down ? p.y > from : p.y < from))
    .sort(([, a], [, b]) => (down ? a.y - b.y : b.y - a.y));
  let edge = down ? m.y + NODE_HEIGHT + NODE_GAP : m.y - NODE_GAP;
  for (const [id, p] of beyond) {
    const y = down ? Math.max(p.y, edge) : Math.min(p.y, edge - NODE_HEIGHT);
    positions.set(id, { x: p.x, y });
    edge = down ? y + NODE_HEIGHT + NODE_GAP : y - NODE_GAP;
  }
}

/**
 * The main flow: node i of row r at x = i * 380 and y = r * 310, and an odd
 * node 90 px higher, so the row zigzags like the video (VID-10, 11).
 */
export function layoutRows(rows: NodeId[][]): Map<NodeId, Position> {
  const out = new Map<NodeId, Position>();
  rows.forEach((row, r) => {
    row.forEach((id, i) => {
      out.set(id, {
        x: i * (NODE_WIDTH + NODE_GAP),
        y: r * (NODE_HEIGHT + ZIGZAG + ROW_GAP) - (i % 2) * ZIGZAG,
      });
    });
  });
  return out;
}

/**
 * Splits each row into rows of at most `perRow` nodes, in order. The flow
 * reads left to right, row after row, like text (VID-10).
 */
export function wrapRows(rows: NodeId[][], perRow: number): NodeId[][] {
  const n = Math.max(1, Math.floor(perRow));
  return rows.flatMap((row) => {
    const out: NodeId[][] = [];
    for (let i = 0; i < row.length; i += n) out.push(row.slice(i, i + n));
    return out;
  });
}

/** A level cut into bands (rows of cards) that stack from top to bottom. */
export interface Bands {
  positions: Map<NodeId, Position>;
  /** The band of each node, from 0 at the top. */
  band: Map<NodeId, number>;
  /** The y in the middle of the gap above each band: a wire into a later band turns there. */
  gapAbove: number[];
}

/** Space between two bands of a wrapped inner level: room for a branch label and the turning wire. */
export const BAND_GAP = 120;

/** The main-flow rows as bands; the gap sits half a `ROW_GAP` above the raised cards (VID-10). */
export function rowBands(rows: NodeId[][]): Bands {
  const band = new Map<NodeId, number>();
  rows.forEach((row, r) => {
    for (const id of row) band.set(id, r);
  });
  const pitch = NODE_HEIGHT + ZIGZAG + ROW_GAP;
  return {
    positions: layoutRows(rows),
    band,
    gapAbove: rows.map((_, r) => r * pitch - ZIGZAG - ROW_GAP / 2),
  };
}

/**
 * Cuts a left-to-right layout into bands of at most `perBand` columns. Each
 * band starts at the left, below the band before it, `BAND_GAP` apart, and
 * keeps its own layout (VID-23).
 */
export function wrapColumns(
  positions: ReadonlyMap<NodeId, Position>,
  perBand: number,
): Bands {
  const n = Math.max(1, Math.floor(perBand));
  const xs = [...new Set([...positions.values()].map((p) => p.x))].sort(
    (a, b) => a - b,
  );
  const column = new Map(xs.map((x, i) => [x, i]));
  const bandOf = (p: Position) => Math.floor((column.get(p.x) ?? 0) / n);
  const count = Math.ceil(xs.length / n);
  const top = Array.from({ length: count }, () => Number.POSITIVE_INFINITY);
  const bottom = Array.from({ length: count }, () => Number.NEGATIVE_INFINITY);
  for (const p of positions.values()) {
    const b = bandOf(p);
    top[b] = Math.min(top[b] ?? 0, p.y);
    bottom[b] = Math.max(bottom[b] ?? 0, p.y + NODE_HEIGHT);
  }
  const shift: number[] = [];
  const gapAbove: number[] = [];
  let y = top[0] ?? 0;
  for (let b = 0; b < count; b++) {
    shift.push(y - (top[b] ?? 0));
    gapAbove.push(y - BAND_GAP / 2);
    y += (bottom[b] ?? 0) - (top[b] ?? 0) + BAND_GAP;
  }
  const out = new Map<NodeId, Position>();
  const band = new Map<NodeId, number>();
  const x0 = xs[0] ?? 0;
  for (const [id, p] of positions) {
    const b = bandOf(p);
    band.set(id, b);
    out.set(id, {
      x: p.x - (xs[b * n] ?? 0) + x0,
      y: p.y + (shift[b] ?? 0),
    });
  }
  return { positions: out, band, gapAbove };
}

/** The `j` of each `/b<j>/` segment of `id`, after the level prefix. */
function branchKey(id: NodeId, containerId: NodeId | null): number[] {
  const rest =
    containerId !== null && id.startsWith(`${containerId}/`)
      ? id.slice(containerId.length)
      : id;
  return [...rest.matchAll(/\/b(\d+)\//g)].map((m) => Number(m[1]));
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0.5) - (b[i] ?? 0.5);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Within each column, gives the column's `y` values again in branch order, so
 * the "true" branch (`b0`) sits above the "false" branch (`b1`) (VID-21). A tie
 * keeps the dagre order.
 */
export function orderBranches(
  positions: Map<NodeId, Position>,
  nodes: FlowNode[],
  containerId: NodeId | null,
): Map<NodeId, Position> {
  const columns = new Map<number, NodeId[]>();
  for (const n of nodes) {
    const p = positions.get(n.id);
    if (!p) continue;
    columns.set(p.x, [...(columns.get(p.x) ?? []), n.id]);
  }
  const out = new Map(positions);
  for (const [x, ids] of columns) {
    const y = (id: NodeId) => positions.get(id)?.y ?? 0;
    const byY = [...ids].sort((a, b) => y(a) - y(b));
    const ys = byY.map(y);
    const ordered = [...byY].sort((a, b) =>
      compareKeys(branchKey(a, containerId), branchKey(b, containerId)),
    );
    ordered.forEach((id, i) => {
      out.set(id, { x, y: ys[i] ?? 0 });
    });
  }
  return out;
}

/** Over this many children and no wire but the hub's, a level lays out as a grid. */
export const HUB_FAN = 4;

/** The left x of grid column `c`: the hub's column comes first. */
const gridX = (c: number) => (c + 1) * (NODE_WIDTH + NODE_GAP);
/** The top y of grid row `r`: the grid starts below the hub. */
const gridY = (r: number) => (r + 1) * (NODE_HEIGHT + NODE_GAP);

/**
 * The hub at the top left and its `leaves` below it, in code order down each
 * of `cols` columns, like an org chart. Each leaf's wire runs on its column's
 * lane, in the gap left of the column, above every card it passes.
 */
export function layoutHubGrid(
  hubId: NodeId,
  leaves: NodeId[],
  cols: number,
): { positions: Map<NodeId, Position>; lanes: Map<NodeId, number> } {
  const n = Math.max(1, Math.min(Math.floor(cols), leaves.length));
  const rows = Math.ceil(leaves.length / n);
  const positions = new Map<NodeId, Position>([[hubId, { x: 0, y: 0 }]]);
  const lanes = new Map<NodeId, number>();
  leaves.forEach((id, i) => {
    const c = Math.floor(i / rows);
    positions.set(id, { x: gridX(c), y: gridY(i % rows) });
    lanes.set(id, gridX(c) - NODE_GAP / 2);
  });
  return { positions, lanes };
}

/** The column count that shows the grid of `count` leaves biggest in a `width` × `height` canvas. */
export function hubGridColumns(
  count: number,
  width: number,
  height: number,
): number {
  if (width <= 0 || height <= 0) return Math.ceil(Math.sqrt(count));
  let best = 1;
  let bestZoom = 0;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const zoom = Math.min(
      width / (gridX(cols - 1) + NODE_WIDTH),
      height / (gridY(rows - 1) + NODE_HEIGHT),
    );
    if (zoom > bestZoom) {
      best = cols;
      bestZoom = zoom;
    }
  }
  return best;
}
