import type { FlowEdge, NodeId } from "@8n8/model";
import { NODE_HEIGHT, NODE_WIDTH, type Position } from "./layout";

interface Run {
  id: string;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  lo: number;
  hi: number;
}

/**
 * The x of the vertical run of each wire that shares its gap with another
 * wire that changes height. Without lanes those wires run on top of each
 * other in the middle of the gap. Two wires share a gap when both their x
 * spans and their y spans overlap; each one gets its own x, spread evenly
 * across the space all of them cross. Wires may cross, but never run together.
 */
export function wireLanes(
  edges: readonly FlowEdge[],
  positions: ReadonlyMap<NodeId, Position>,
  skip: ReadonlySet<string> = new Set(),
): Map<string, number> {
  const runs: Run[] = [];
  for (const e of edges) {
    const s = positions.get(e.source);
    const t = positions.get(e.target);
    if (!s || !t || skip.has(e.id)) continue;
    const x1 = s.x + NODE_WIDTH;
    const x2 = t.x;
    const y1 = s.y + NODE_HEIGHT / 2;
    const y2 = t.y + NODE_HEIGHT / 2;
    if (x2 <= x1 || y1 === y2) continue;
    runs.push({
      id: e.id,
      x1,
      x2,
      y1,
      y2,
      lo: Math.min(y1, y2),
      hi: Math.max(y1, y2),
    });
  }
  const group = runs.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (group[r] !== r) r = group[r] ?? r;
    return r;
  };
  runs.forEach((a, i) => {
    runs.forEach((b, j) => {
      if (j <= i) return;
      const sameX = Math.max(a.x1, b.x1) < Math.min(a.x2, b.x2);
      const sameY = Math.max(a.lo, b.lo) < Math.min(a.hi, b.hi);
      if (sameX && sameY) group[root(j)] = root(i);
    });
  });
  const clusters = new Map<number, Run[]>();
  runs.forEach((r, i) => {
    const k = root(i);
    clusters.set(k, [...(clusters.get(k) ?? []), r]);
  });
  const out = new Map<string, number>();
  for (const c of clusters.values()) {
    if (c.length < 2) continue;
    const left = Math.max(...c.map((r) => r.x1));
    const right = Math.min(...c.map((r) => r.x2));
    if (right <= left) continue;
    const step = (right - left) / (c.length + 1);
    const ordered = [...c].sort(
      (a, b) => a.y1 - b.y1 || a.y2 - b.y2 || a.id.localeCompare(b.id),
    );
    ordered.forEach((r, i) => {
      out.set(r.id, left + (i + 1) * step);
    });
  }
  return out;
}
