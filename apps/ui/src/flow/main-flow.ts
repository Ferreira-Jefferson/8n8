import type { FlowNode, Graph, NodeId } from "@8n8/model";

/** One row of the main flow: an entry and its commands with a call (VID-10). */
export interface MainRow {
  entry: NodeId;
  steps: NodeId[];
}

const byStart = (a: FlowNode, b: FlowNode) => a.range.start - b.range.start;

/** A call or an external call. A return belongs to the inside of the function, even when it calls something. */
function isCall(node: FlowNode): boolean {
  return node.kind === "call" || node.kind === "external";
}

/** Rule 1: the direct steps `<owner>/s<i>` of `owner`, without branch steps, in code order. */
function directSteps(graph: Graph, owner: NodeId): FlowNode[] {
  const prefix = `${owner}/s`;
  return graph.nodes
    .filter(
      (n) =>
        n.parentId === owner &&
        n.id.startsWith(prefix) &&
        /^\d+$/.test(n.id.slice(prefix.length)),
    )
    .sort(byStart);
}

/** Rule 2: a direct step that is a call, or a loop, block or condition with one inside. */
function commandsWithCall(graph: Graph, owner: NodeId): FlowNode[] {
  return directSteps(graph, owner).filter((step) => {
    if (isCall(step)) return true;
    if (
      step.kind !== "loop" &&
      step.kind !== "block" &&
      step.kind !== "condition"
    ) {
      return false;
    }
    const inside = `${step.id}/`;
    return graph.nodes.some((n) => n.id.startsWith(inside) && isCall(n));
  });
}

/** Whether the loose code `owner` runs a call: a module without one only sets names. */
export function hasCommands(graph: Graph, owner: NodeId): boolean {
  return commandsWithCall(graph, owner).length > 0;
}

/**
 * The rows of the main flow of a snippet (VID-10, 11, 12): one per top
 * function or class, plus one per top node with a syntax error (rule 4,
 * CORE-06), in code order (rule 5). Only an entry (rule 3) shows its steps.
 */
export function mainFlowRows(graph: Graph): MainRow[] {
  const top = graph.nodes.filter((n) => n.parentId === null);
  const entries = new Set<NodeId>();
  for (const n of top) {
    if (n.kind === "module" && commandsWithCall(graph, n.id).length > 0) {
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
        ? commandsWithCall(graph, n.id).map((s) => s.id)
        : [],
    }));
}
