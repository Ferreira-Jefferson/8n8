import type { FlowEdge, FlowNode, Graph, NodeId } from "@code2n8n/model";

export interface Level {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * The nodes and wires visible at one level: the top level (`null`) or the
 * direct children of `containerId` (CORE-01, 03, 08, 09, 10, 13).
 */
export function projectLevel(graph: Graph, containerId: NodeId | null): Level {
  const nodes = graph.nodes.filter((n) => n.parentId === containerId);
  const visible = new Set(nodes.map((n) => n.id));
  if (containerId !== null) {
    const edges = graph.edges.filter(
      (e) =>
        e.kind !== "calls" && visible.has(e.source) && visible.has(e.target),
    );
    return { nodes, edges };
  }
  return { nodes, edges: liftedCalls(graph, visible) };
}

/** Lifts both ends of each `calls` wire to its top-level ancestor (CORE-02). */
function liftedCalls(graph: Graph, visible: Set<NodeId>): FlowEdge[] {
  const parent = new Map(graph.nodes.map((n) => [n.id, n.parentId]));
  const lift = (id: NodeId): NodeId | null => {
    let current: NodeId | null = id;
    while (current !== null && !visible.has(current)) {
      current = parent.get(current) ?? null;
    }
    return current;
  };
  const out = new Map<string, FlowEdge>();
  for (const e of graph.edges) {
    if (e.kind !== "calls") continue;
    const source = lift(e.source);
    const target = lift(e.target);
    if (source === null || target === null || source === target) continue;
    const id = `calls:${source}->${target}`;
    if (!out.has(id)) out.set(id, { id, kind: "calls", source, target });
  }
  return [...out.values()];
}
