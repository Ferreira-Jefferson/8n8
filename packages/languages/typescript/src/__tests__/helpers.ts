import type { FlowNode, Graph } from "@8n8/model";
import { expect } from "vitest";
import { typescriptPlugin } from "../index";

export function extract(source: string): Graph {
  return typescriptPlugin.extract(source);
}

export function node(graph: Graph, id: string): FlowNode {
  const found = graph.nodes.find((n) => n.id === id);
  if (!found) {
    throw new Error(`no node ${id}; have ${graph.nodes.map((n) => n.id)}`);
  }
  return found;
}

/** `[id, kind, label]` of every node, in order. */
export function outline(graph: Graph): [string, string, string][] {
  return graph.nodes.map((n) => [n.id, n.kind, n.label]);
}

/** `kind source -> target label` of every wire of a kind. */
export function wires(graph: Graph, kind: string): string[] {
  return graph.edges
    .filter((e) => e.kind === kind)
    .map((e) => `${e.source} -> ${e.target}${e.label ? ` [${e.label}]` : ""}`);
}

const OPENABLE = new Set([
  "folder",
  "file",
  "module",
  "function",
  "class",
  "loop",
  "block",
]);

/**
 * What every plugin must give: unique ids, parents before children,
 * wires between existing nodes, 1-based lines inside the source, and the
 * `openable` rule.
 */
export function expectWellFormed(
  graph: Graph,
  lineCount: number,
  { partial = false } = {},
): void {
  const seen = new Set<string>();
  for (const n of graph.nodes) {
    expect(seen.has(n.id), `duplicate id ${n.id}`).toBe(false);
    // In a file graph the folder is laid out by the core, and calls may leave the file.
    if (n.parentId !== null && !(partial && n.parentId.startsWith("dir:"))) {
      expect(seen.has(n.parentId), `parent of ${n.id} comes first`).toBe(true);
    }
    seen.add(n.id);
    expect(n.range.start).toBeGreaterThanOrEqual(1);
    expect(n.range.end).toBeGreaterThanOrEqual(n.range.start);
    expect(n.range.end).toBeLessThanOrEqual(lineCount);
    expect(n.openable, `openable of ${n.id}`).toBe(
      n.kind === "call" ? n.target !== undefined : OPENABLE.has(n.kind),
    );
    if (n.kind === "external") {
      expect(n.callee).toBeDefined();
      expect(n.category).toBeDefined();
    }
  }
  const edgeIds = new Set<string>();
  for (const e of graph.edges) {
    expect(edgeIds.has(e.id), `duplicate edge ${e.id}`).toBe(false);
    edgeIds.add(e.id);
    expect(seen.has(e.source), `source of ${e.id}`).toBe(true);
    expect(partial || seen.has(e.target), `target of ${e.id}`).toBe(true);
    expect(e.kind).not.toBe("contains");
  }
  expect(graph.empty).toBe(graph.nodes.length === 0);
}

export function lines(source: string): number {
  return source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
}
