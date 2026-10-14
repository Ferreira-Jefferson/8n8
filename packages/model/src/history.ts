import type { Graph } from "./graph";
import type { ProjectResponse } from "./project";

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
  /** Sizes of what was read: lines and bytes of all the code, number of .py files, nodes and wires of the graph. */
  lines: number;
  bytes: number;
  files: number;
  nodes: number;
  edges: number;
}

/** A saved map, whole: opening it asks no parser and reads no disk. */
export type HistoryEntry =
  | { kind: "snippet"; source: string; graph: Graph }
  | { kind: "project"; root: string; response: ProjectResponse };
