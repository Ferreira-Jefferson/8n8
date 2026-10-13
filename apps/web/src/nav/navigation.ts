import type { FlowNode, NodeId } from "@code2n8n/model";

export interface NavState {
  path: NodeId[];
  selected: NodeId | null;
}

export type NavAction =
  | { type: "open"; node: FlowNode }
  | { type: "goTo"; index: number }
  | { type: "select"; id: NodeId };

export const initialNav: NavState = { path: [], selected: null };

function openTarget(node: FlowNode): NodeId | null {
  switch (node.kind) {
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

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "open": {
      const id = openTarget(action.node);
      if (id === null) return state;
      return { path: [...state.path, id], selected: null };
    }
    case "goTo":
      return { path: state.path.slice(0, action.index), selected: null };
    case "select":
      return { ...state, selected: action.id };
  }
}
