import type { FlowEdge, FlowNode, NodeId } from "@code2n8n/model";
import { Graph, layout } from "@dagrejs/dagre";

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 56;

export interface Position {
  x: number;
  y: number;
}

/** Left-to-right layout; returns the top-left position of each node. */
export function layoutLR(
  nodes: FlowNode[],
  edges: FlowEdge[],
): Map<NodeId, Position> {
  const g = new Graph();
  g.setGraph({ rankdir: "LR" });
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
  return out;
}
