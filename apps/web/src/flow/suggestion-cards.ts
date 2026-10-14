import type { Explanation, FlowNode, NodeId } from "@code2n8n/model";
import type { Level } from "./project-level";

export interface SuggestionCardModel {
  /** `${explainedId}:${suggestion.id}` */
  key: string;
  /** The node whose panel opens on click. */
  explainedId: NodeId;
  /** `null` = stuck to the frame of the open node. */
  anchorId: NodeId | null;
  /** suggestion.command */
  text: string;
  /** suggestion.line (absolute) */
  line: number;
}

/**
 * One card per suggestion of the explanations behind the visible nodes and
 * the level node, anchored on the smallest visible node that holds its line
 * (VID-31).
 */
export function suggestionCards(
  level: Level,
  explanations: ReadonlyMap<NodeId, Explanation>,
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
    for (const s of explanations.get(explainedId)?.suggestions ?? []) {
      cards.push({
        key: `${explainedId}:${s.id}`,
        explainedId,
        anchorId: anchorOf(level.nodes, s.line) ?? owner,
        text: s.command,
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

/** The anchored nodes, drawn with the `on` border while the others dim (VID-32). */
export function highlighted(
  cards: readonly SuggestionCardModel[],
): ReadonlySet<NodeId> {
  return new Set(
    cards.flatMap((c) => (c.anchorId === null ? [] : [c.anchorId])),
  );
}
