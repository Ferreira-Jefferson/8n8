import type { FlowNode, Graph } from "@code2n8n/model";
import type { Node, Tree } from "web-tree-sitter";

/**
 * Lines where each statement of `statements` starting a new line should
 * start at `column` but does not.
 */
function misindented(statements: Node[], column: number): number[] {
  const lines: number[] = [];
  let previousEnd = -1;
  for (const statement of statements) {
    if (statement.type === "comment") continue;
    const { row, column: at } = statement.startPosition;
    if (row !== previousEnd && at !== column) lines.push(row + 1);
    previousEnd = statement.endPosition.row;
  }
  return lines;
}

/**
 * 1-based lines of every ERROR and MISSING node.
 *
 * SPEC_DEVIATION: also reports misindented statements.
 * Reason: tree-sitter-python accepts unexpected indents and unmatched
 * dedents without ERROR or MISSING nodes, so CORE-06 would miss them.
 */
function errorLines(root: Node): number[] {
  const lines = misindented(root.namedChildren, 0);
  const visit = (node: Node) => {
    if (node.type === "ERROR" || node.isMissing) {
      lines.push(node.startPosition.row + 1);
    }
    if (node.type === "block") {
      const statements = node.namedChildren.filter((s) => s.type !== "comment");
      const column = statements[0]?.startPosition.column ?? 0;
      lines.push(...misindented(statements, column));
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return [...new Set(lines)].sort((a, b) => a - b);
}

/** Smallest node whose range contains `line`; the deeper one wins a tie. */
function innermost(nodes: FlowNode[], line: number): FlowNode | undefined {
  let best: FlowNode | undefined;
  for (const node of nodes) {
    if (line < node.range.start || line > node.range.end) continue;
    const span = node.range.end - node.range.start;
    if (!best || span <= best.range.end - best.range.start) best = node;
  }
  return best;
}

/** The module node, created at `line` when the snippet has none. */
function moduleFor(nodes: FlowNode[], line: number): FlowNode {
  const existing = nodes.find((n) => n.id === "mod");
  if (existing) return existing;
  const created: FlowNode = {
    id: "mod",
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

/** Marks `syntaxError.line` on the innermost node of each error line (CORE-06). */
export function markSyntaxErrors(tree: Tree, graph: Graph): Graph {
  const lines = errorLines(tree.rootNode);
  if (lines.length === 0) return graph;
  const nodes = graph.nodes.map((n) => ({ ...n }));
  for (const line of lines) {
    const target = innermost(nodes, line) ?? moduleFor(nodes, line);
    target.syntaxError ??= { line };
  }
  return { ...graph, empty: nodes.length === 0, nodes };
}
