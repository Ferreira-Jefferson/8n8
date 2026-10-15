import { markErrorLines } from "@8n8/lang-treesitter";
import type { Graph } from "@8n8/model";
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
 * SPEC_DEVIATION: also reports misindented statements and empty blocks.
 * Reason: tree-sitter-python accepts unexpected indents, unmatched
 * dedents and missing indented blocks without ERROR or MISSING nodes, so
 * CORE-06 would miss them.
 */
function errorLines(root: Node): number[] {
  const lines = misindented(root.namedChildren, 0);
  const visit = (node: Node) => {
    if (node.type === "ERROR" || node.isMissing) {
      lines.push(node.startPosition.row + 1);
    }
    if (node.type === "block") {
      const statements = node.namedChildren.filter((s) => s.type !== "comment");
      const header = node.parent;
      // Expected an indented block, reported on the header that lacks it.
      // A header holding an ERROR already reports the swallowed body.
      if (statements.length === 0 && header && !header.hasError) {
        lines.push(header.startPosition.row + 1);
      }
      const column = statements[0]?.startPosition.column ?? 0;
      lines.push(...misindented(statements, column));
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return [...new Set(lines)].sort((a, b) => a - b);
}

/** Marks `syntaxError.line` on the innermost node of each error line (CORE-06). */
export function markSyntaxErrors(tree: Tree, graph: Graph): Graph {
  return markErrorLines(graph, errorLines(tree.rootNode));
}
