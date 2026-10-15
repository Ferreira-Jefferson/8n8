/** One row of the history list: light, never carries the graph or the code. */
export interface HistoryItem {
  id: number;
  kind: "snippet" | "project";
  /** A snippet: its first non-empty line. A project: the folder name. */
  title: string;
  /** Project only: the absolute path read. */
  root?: string;
  /** Epoch ms of the first search. */
  createdAt: number;
  /** Epoch ms of the last time it was searched or opened. */
  openedAt: number;
  openCount: number;
  /** Marked with a star: shown under Favoritos and never pruned. */
  starred: boolean;
  /** Sizes of what was read: lines and bytes of all the code, number of source files, nodes and wires of the graph. */
  lines: number;
  bytes: number;
  files: number;
  nodes: number;
  edges: number;
}

/**
 * What the history keeps to open a map again: a folder's path, or a snippet's text and
 * language. Never the code of a folder nor a graph: opening re-reads the folder or the text (CLEAN-08).
 */
export type HistoryEntry =
  | { kind: "snippet"; source: string; language: string }
  | { kind: "project"; root: string };
