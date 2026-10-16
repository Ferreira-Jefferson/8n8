import type { FlowNode, NodeId, Severity, Suggestion } from "@8n8/model";
import type { Level } from "./project-level";

export interface SuggestionCardModel {
  /** `${explainedId}:${suggestion.id}` */
  key: string;
  /** The node whose panel opens on click. */
  explainedId: NodeId;
  /** `null` = no visible node holds the line: the badge of the level's hub shows it. */
  anchorId: NodeId | null;
  /** suggestion.command */
  text: string;
  /** suggestion.reason */
  reason: string;
  severity: Severity;
  /** suggestion.line (absolute) */
  line: number;
}

/**
 * One card per suggestion of the nodes behind the visible nodes and
 * the level node, anchored on the smallest visible node that holds its line
 * (VID-31).
 */
export function suggestionCards(
  level: Level,
  suggestions: ReadonlyMap<NodeId, Suggestion[]>,
  containerId: NodeId | null,
  panelNodeOf: (node: FlowNode) => NodeId,
): SuggestionCardModel[] {
  const owners = new Map<NodeId, NodeId | null>();
  for (const v of level.nodes) {
    const id = panelNodeOf(v);
    if (!owners.has(id)) owners.set(id, v.id);
  }
  if (containerId !== null && !owners.has(containerId)) {
    owners.set(containerId, null);
  }
  const cards: SuggestionCardModel[] = [];
  for (const [explainedId, owner] of owners) {
    for (const s of suggestions.get(explainedId) ?? []) {
      cards.push({
        key: `${explainedId}:${s.id}`,
        explainedId,
        anchorId: anchorOf(level.nodes, s.line) ?? owner,
        text: s.command,
        reason: s.reason,
        severity: s.severity,
        line: s.line,
      });
    }
  }
  return cards;
}

/** The visible node with the smallest range that holds `line`; the first one on a tie. */
function anchorOf(nodes: FlowNode[], line: number): NodeId | null {
  let best: FlowNode | null = null;
  for (const n of nodes) {
    if (line < n.range.start || line > n.range.end) continue;
    const size = n.range.end - n.range.start;
    if (best === null || size < best.range.end - best.range.start) best = n;
  }
  return best?.id ?? null;
}

/**
 * The suggestions each drawn node shows in its badge: by anchor, and the ones
 * with no anchor on the hub of the level, when there is one.
 */
export function suggestionsByNode(
  cards: readonly SuggestionCardModel[],
  hubId: NodeId | null,
): ReadonlyMap<NodeId, SuggestionCardModel[]> {
  const byNode = new Map<NodeId, SuggestionCardModel[]>();
  for (const c of cards) {
    const id = c.anchorId ?? hubId;
    if (id === null) continue;
    byNode.set(id, [...(byNode.get(id) ?? []), c]);
  }
  return byNode;
}
