import type {
  EdgeKind,
  FlowEdge,
  FlowNode,
  Graph,
  NodeId,
} from "@code2n8n/model";
import { mainFlowRows } from "./main-flow";

export interface Level {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Only on the main flow: the node IDs of each row, in order (VID-10, 11). */
  rows?: NodeId[][];
  /** The entries drawn as GATILHO; empty outside the main flow (VID-12). */
  triggers: ReadonlySet<NodeId>;
}

const NO_TRIGGERS: ReadonlySet<NodeId> = new Set();

/**
 * The nodes and wires visible at one level: the top level (`null`) or the
 * direct children of `containerId` (CORE-03, 08, 09, 10, 13). The top level of
 * a snippet is the main flow (VID-10, 11, 12). On a project graph, the top and
 * folder levels lift `imports` wires and a file level lifts `calls` wires
 * (PROJ-02, 03, 04).
 */
export function projectLevel(graph: Graph, containerId: NodeId | null): Level {
  if (containerId === null && !graph.project) return mainFlow(graph);
  const nodes = graph.nodes.filter((n) => n.parentId === containerId);
  const visible = new Set(nodes.map((n) => n.id));
  if (graph.project) {
    const kind = containerId === null ? "folder" : kindOf(graph, containerId);
    if (kind === "folder") {
      return {
        nodes,
        edges: lifted(graph, visible, "imports"),
        triggers: NO_TRIGGERS,
      };
    }
    if (kind === "file") {
      return {
        nodes,
        edges: lifted(graph, visible, "calls"),
        triggers: NO_TRIGGERS,
      };
    }
  }
  const edges = graph.edges.filter(
    (e) => e.kind !== "calls" && visible.has(e.source) && visible.has(e.target),
  );
  return { nodes, edges, triggers: NO_TRIGGERS };
}

/** The main flow of a snippet: each row's entry and steps, with synthetic wires. */
function mainFlow(graph: Graph): Level {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const main = mainFlowRows(graph);
  const rows = main.map((r) => [r.trigger, ...r.steps]);
  const nodes = rows.flat().flatMap((id) => byId.get(id) ?? []);
  const edges: FlowEdge[] = rows.flatMap((row) =>
    row.slice(1).map((target, i) => {
      const source = row[i] as NodeId;
      return { id: `main:${source}->${target}`, kind: "next", source, target };
    }),
  );
  return { nodes, edges, rows, triggers: new Set(main.map((r) => r.trigger)) };
}

function kindOf(graph: Graph, id: NodeId) {
  return graph.nodes.find((n) => n.id === id)?.kind;
}

/**
 * Lifts both ends of each `kind` wire to its visible ancestor (CORE-02). A wire
 * with an end that has no visible ancestor, or that lifts onto one node, drops.
 */
function lifted(
  graph: Graph,
  visible: Set<NodeId>,
  kind: EdgeKind,
): FlowEdge[] {
  const parent = new Map(graph.nodes.map((n) => [n.id, n.parentId]));
  const lift = (id: NodeId): NodeId | null => {
    let current: NodeId | null = id;
    while (current !== null && !visible.has(current)) {
      current = parent.get(current) ?? null;
    }
    return current;
  };
  const out = new Map<string, FlowEdge>();
  for (const e of graph.edges) {
    if (e.kind !== kind) continue;
    const source = lift(e.source);
    const target = lift(e.target);
    if (source === null || target === null || source === target) continue;
    const id = `${kind}:${source}->${target}`;
    if (!out.has(id)) out.set(id, { id, kind, source, target });
  }
  return [...out.values()];
}
