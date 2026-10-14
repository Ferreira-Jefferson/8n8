import type { FlowEdge, FlowNode, NodeId } from "@code2n8n/model";
import { Graph, layout } from "@dagrejs/dagre";

export const NODE_WIDTH = 320;
export const NODE_HEIGHT = 140;
export const NODE_GAP = 60;
export const ROW_GAP = 80;
/** Odd cards of a main-flow row sit this much higher, like the video's 470/380 (VID-10). */
export const ZIGZAG = 90;

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
  return orderBranches(out, nodes, containerId);
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
 * the "sim" branch (`b0`) sits above the "não" branch (`b1`) (VID-21). A tie
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
