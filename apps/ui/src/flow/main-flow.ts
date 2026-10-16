import {
  commandsWithCall,
  type FlowNode,
  type Graph,
  type NodeId,
} from "@8n8/model";

/** One row of the main flow: an entry and its commands with a call (VID-10). */
export interface MainRow {
  entry: NodeId;
  steps: NodeId[];
}

const byStart = (a: FlowNode, b: FlowNode) => a.range.start - b.range.start;

/**
 * The rows of the main flow of a snippet (VID-10, 11, 12): one per top
 * function or class, plus one per top node with a syntax error (rule 4,
 * CORE-06), in code order (rule 5). Only an entry (rule 3) shows its steps.
 */
export function mainFlowRows(graph: Graph): MainRow[] {
  const top = graph.nodes.filter((n) => n.parentId === null);
  const entries = new Set<NodeId>();
  for (const n of top) {
    if (n.kind === "module" && commandsWithCall(graph.nodes, n.id).length > 0) {
      entries.add(n.id);
    }
    const called = graph.edges.some(
      (e) => e.kind === "calls" && e.target === n.id && e.source !== n.id,
    );
    if (n.kind === "function" && !called) entries.add(n.id);
  }
  if (entries.size === 0) {
    for (const n of top) {
      if (n.kind === "function" || n.kind === "class") entries.add(n.id);
    }
  }
  return top
    .filter(
      (n) =>
        entries.has(n.id) ||
        n.kind === "function" ||
        n.kind === "class" ||
        n.syntaxError !== undefined,
    )
    .sort(byStart)
    .map((n) => ({
      entry: n.id,
      steps: entries.has(n.id)
        ? commandsWithCall(graph.nodes, n.id).map((s) => s.id)
        : [],
    }));
}
