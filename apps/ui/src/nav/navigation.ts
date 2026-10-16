import type { FlowNode, Graph, NodeId } from "@8n8/model";

/** An opened level; `via` is the card clicked on the level above. */
export interface Opened {
  id: NodeId;
  via: NodeId;
}

export interface NavState {
  path: Opened[];
  selected: NodeId | null;
}

export type NavAction =
  /** Opens the node when it has an inner flow; otherwise only selects it. */
  | { type: "click"; node: FlowNode }
  /** Goes back one level; does nothing on the top level. */
  | { type: "back" }
  /** Breadcrumb: keeps `path[0..index)`. */
  | { type: "goTo"; index: number }
  /** Suggestion card (VID-33). */
  | { type: "select"; id: NodeId }
  | { type: "jump"; path: NodeId[]; via: NodeId }
  /** Search: opens each level of `path` and selects `id`, a node of the last one. */
  | { type: "reveal"; path: NodeId[]; id: NodeId };

export const initialNav: NavState = { path: [], selected: null };

/** IDs from the top level down to `id`, inclusive; `[]` when `id` is absent (PROJ-04). */
export function ancestry(graph: Graph, id: NodeId): NodeId[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: NodeId[] = [];
  let node = byId.get(id);
  while (node) {
    out.unshift(node.id);
    node = node.parentId === null ? undefined : byId.get(node.parentId);
  }
  return out;
}

function openTarget(node: FlowNode): NodeId | null {
  switch (node.kind) {
    case "folder":
    case "file":
    case "function":
    case "class":
    case "module":
    case "loop":
    case "block":
      return node.id;
    case "call":
      return node.target ?? null;
    default:
      return null;
  }
}

/**
 * Whether a node has a panel: code, a summary or suggestions to show. A folder has none of
 * these, so it never opens the panel, and its card has no button for it.
 */
export function hasPanel(node: FlowNode): boolean {
  return node.kind !== "folder";
}

/** The node whose panel shows: a call shows its target's panel. */
export function panelNodeOf(node: FlowNode): NodeId {
  return node.kind === "call" && node.target !== undefined
    ? node.target
    : node.id;
}

/** Click opens, "Voltar" and the breadcrumb go back to the card you came from (VID-23, 24, 25, 27). */
export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "click": {
      const { node } = action;
      const id = openTarget(node);
      if (id === null) return { ...state, selected: node.id };
      return {
        path: [...state.path, { id, via: node.id }],
        selected: node.id,
      };
    }
    case "back":
      return goTo(state, state.path.length - 1);
    case "goTo":
      return goTo(state, action.index);
    case "select":
      return { ...state, selected: action.id };
    case "jump": {
      const last = action.path.length - 1;
      return {
        path: action.path.map((id, i) => ({
          id,
          via: i === last ? action.via : id,
        })),
        selected: action.via,
      };
    }
    case "reveal":
      return {
        path: action.path.map((id) => ({ id, via: id })),
        selected: action.id,
      };
  }
}

function goTo(state: NavState, index: number): NavState {
  const left = state.path[index];
  if (index < 0 || left === undefined) return state;
  return { path: state.path.slice(0, index), selected: left.via };
}
