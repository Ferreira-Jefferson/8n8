import type { FlowNode, NodeId } from "./graph";

const byStart = (a: FlowNode, b: FlowNode) => a.range.start - b.range.start;

/** A call or an external call. A return belongs to the inside of the function, even when it calls something. */
function isCall(node: FlowNode): boolean {
  return node.kind === "call" || node.kind === "external";
}

/** Rule 1: the direct steps `<owner>/s<i>` of `owner`, without branch steps, in code order. */
function directSteps(nodes: readonly FlowNode[], owner: NodeId): FlowNode[] {
  const prefix = `${owner}/s`;
  return nodes
    .filter(
      (n) =>
        n.parentId === owner &&
        n.id.startsWith(prefix) &&
        /^\d+$/.test(n.id.slice(prefix.length)),
    )
    .sort(byStart);
}

/**
 * Rule 2: a direct step of `owner` that is a call, or a loop, block or condition
 * with one inside. `nodes` holds at least the nodes of the file of `owner`.
 */
export function commandsWithCall(
  nodes: readonly FlowNode[],
  owner: NodeId,
): FlowNode[] {
  return directSteps(nodes, owner).filter((step) => {
    if (isCall(step)) return true;
    if (
      step.kind !== "loop" &&
      step.kind !== "block" &&
      step.kind !== "condition"
    ) {
      return false;
    }
    const inside = `${step.id}/`;
    return nodes.some((n) => n.id.startsWith(inside) && isCall(n));
  });
}

/** Whether the loose code `owner` runs a call: a module without one only sets names. */
export function hasCommands(
  nodes: readonly FlowNode[],
  owner: NodeId,
): boolean {
  return commandsWithCall(nodes, owner).length > 0;
}

/** Loose code with no call only sets names: it shows in the file's panel, not on the file's level. */
export function shownInFile(nodes: readonly FlowNode[], n: FlowNode): boolean {
  return (
    n.kind !== "module" ||
    n.syntaxError !== undefined ||
    hasCommands(nodes, n.id)
  );
}
