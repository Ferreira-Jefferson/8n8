import type { LineRange } from "@8n8/model";
import type { Node } from "web-tree-sitter";

/** 1-based, inclusive lines of a tree-sitter node. */
export function lineRange(node: Node): LineRange {
  const end = node.endPosition;
  const endsAtLineStart = end.column === 0 && end.row > node.startPosition.row;
  return {
    start: node.startPosition.row + 1,
    end: endsAtLineStart ? end.row : end.row + 1,
  };
}

/** Number of the last line of `source`; a trailing newline does not open one. */
export function lastLine(source: string): number {
  const lines = source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
  return Math.max(1, lines);
}
