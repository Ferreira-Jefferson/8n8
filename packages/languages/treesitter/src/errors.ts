import type { FlowNode, Graph } from "@8n8/model";
import type { Node, Tree } from "web-tree-sitter";

/** 1-based lines of every ERROR and MISSING node. */
export function treeErrorLines(root: Node): number[] {
  const lines: number[] = [];
  const visit = (node: Node) => {
    if (node.type === "ERROR" || node.isMissing) {
      lines.push(node.startPosition.row + 1);
    }
    for (const child of node.children) {
      if (child.hasError || child.isMissing) visit(child);
    }
  };
  if (root.hasError) visit(root);
  return [...new Set(lines)].sort((a, b) => a - b);
}

/** Smallest node whose range contains `line`; the deeper one wins a tie. */
export function innermost(
  nodes: FlowNode[],
  line: number,
): FlowNode | undefined {
  let best: FlowNode | undefined;
  for (const node of nodes) {
    if (line < node.range.start || line > node.range.end) continue;
    const span = node.range.end - node.range.start;
    if (!best || span <= best.range.end - best.range.start) best = node;
  }
  return best;
}

/** The module node, created at `line` when the snippet has none. */
function moduleFor(
  nodes: FlowNode[],
  line: number,
  moduleId: string,
): FlowNode {
  const existing = nodes.find((n) => n.id === moduleId);
  if (existing) return existing;
  const created: FlowNode = {
    id: moduleId,
    kind: "module",
    label: "Módulo",
    parentId: null,
    range: { start: line, end: line },
    openable: true,
  };
  const after = nodes.findIndex(
    (n) => n.parentId === null && n.range.start > line,
  );
  nodes.splice(after === -1 ? nodes.length : after, 0, created);
  return created;
}

/** Marks `syntaxError.line` on the innermost node of each of `lines`. */
export function markErrorLines(
  graph: Graph,
  lines: number[],
  moduleId = "mod",
): Graph {
  if (lines.length === 0) return graph;
  const nodes = graph.nodes.map((n) => ({ ...n }));
  for (const line of lines) {
    const target = innermost(nodes, line) ?? moduleFor(nodes, line, moduleId);
    target.syntaxError ??= { line };
  }
  return { ...graph, empty: nodes.length === 0, nodes };
}

/** Marks the ERROR and MISSING nodes of `tree` on `graph`. */
export function markSyntaxErrors(
  tree: Tree,
  graph: Graph,
  moduleId = "mod",
): Graph {
  return markErrorLines(graph, treeErrorLines(tree.rootNode), moduleId);
}
