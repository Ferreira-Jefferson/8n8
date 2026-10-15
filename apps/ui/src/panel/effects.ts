import type { ExternalEffect, Graph, NodeId } from "@8n8/model";

/** External steps below a node in the graph, by line, without the LLM (FID-14). */
export function externalEffects(
  graph: Graph,
  nodeId: NodeId,
): ExternalEffect[] {
  const parent = new Map(graph.nodes.map((n) => [n.id, n.parentId]));
  const descends = (id: NodeId): boolean => {
    for (let p = parent.get(id); p; p = parent.get(p)) {
      if (p === nodeId) return true;
    }
    return false;
  };
  return graph.nodes
    .flatMap((n) =>
      n.kind === "external" && n.category && descends(n.id)
        ? [
            {
              callee: n.callee ?? n.label,
              category: n.category,
              line: n.range.start,
            },
          ]
        : [],
    )
    .sort((a, b) => a.line - b.line);
}
