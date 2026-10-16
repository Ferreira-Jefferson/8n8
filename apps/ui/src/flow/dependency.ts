import type { FlowEdge, NodeId } from "@8n8/model";
import { isDependency } from "./edge-kind";
import { NODE_HEIGHT, NODE_WIDTH, type Position } from "./layout";
import { backSides, pickSides, Side } from "./sides";

export { isDependency } from "./edge-kind";

/**
 * The dependency wires that run against another one between the same two
 * nodes (a calls b, b calls a): the second of each pair, in ID order. They draw
 * on the other sides of the cards, so the two lines never lie on each other.
 */
export function backWires(edges: readonly FlowEdge[]): Set<string> {
  const byPair = new Map<string, string>();
  const deps = edges.filter((e) => isDependency(e.kind));
  for (const e of deps) byPair.set(`${e.source}->${e.target}`, e.id);
  const back = new Set<string>();
  for (const e of deps) {
    if (e.source === e.target) continue;
    const reverse = byPair.get(`${e.target}->${e.source}`);
    if (reverse !== undefined && e.id > reverse) back.add(e.id);
  }
  return back;
}

/**
 * Whether a straight vertical wire from `source` to `target` runs behind
 * another card: a card in the gap between the two whose width holds the
 * wire's x, which is the middle of the source card.
 */
function crossesCard(
  source: NodeId,
  target: NodeId,
  positions: ReadonlyMap<NodeId, Position>,
): boolean {
  const from = positions.get(source);
  const to = positions.get(target);
  if (!from || !to) return false;
  const x = from.x + NODE_WIDTH / 2;
  const lo = Math.min(from.y, to.y) + NODE_HEIGHT;
  const hi = Math.max(from.y, to.y);
  for (const [id, p] of positions) {
    if (id === source || id === target) continue;
    if (x <= p.x || x >= p.x + NODE_WIDTH) continue;
    if (p.y < hi && p.y + NODE_HEIGHT > lo) return true;
  }
  return false;
}

/**
 * The sides each wire leaves and arrives by, for the wires that do not keep the
 * layout's right and left. A wire that touches a card the viewer moved picks
 * the sides that face each other. A dependency wire does too when it runs
 * between the rows of the main flow (`rows`) or back to a card that is not to
 * the right of its origin. The one that runs back between two cards leaves by
 * the other sides, and so does one that would run behind a card between its
 * ends. A wire that returns to its own card keeps right and left.
 */
export function wireSides(
  edges: readonly FlowEdge[],
  positions: ReadonlyMap<NodeId, Position>,
  options: { rows: boolean; moved?: ReadonlySet<NodeId> | undefined },
): Map<string, readonly [Side, Side]> {
  const back = backWires(edges);
  const sides = new Map<string, readonly [Side, Side]>();
  for (const e of edges) {
    const from = positions.get(e.source);
    const to = positions.get(e.target);
    if (!from || !to || e.source === e.target) continue;
    if (back.has(e.id)) {
      sides.set(e.id, backSides(from, to));
      continue;
    }
    const facing =
      options.moved?.has(e.source) ||
      options.moved?.has(e.target) ||
      (isDependency(e.kind) && (options.rows || to.x < from.x + NODE_WIDTH));
    if (!facing) continue;
    const picked = pickSides(from, to);
    const vertical = picked[0] === Side.Bottom || picked[0] === Side.Top;
    const blocked =
      isDependency(e.kind) &&
      vertical &&
      crossesCard(e.source, e.target, positions);
    sides.set(e.id, blocked ? [Side.Left, Side.Left] : picked);
  }
  return sides;
}
