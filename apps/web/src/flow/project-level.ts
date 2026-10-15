import type { EdgeKind, FlowEdge, FlowNode, Graph, NodeId } from "@8n8/model";
import { hasCommands, mainFlowRows } from "./main-flow";

export interface Level {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Only on the main flow: the node IDs of each row, in order (VID-10, 11). */
  rows?: NodeId[][];
  /** The entries drawn as GATILHO; empty outside the main flow (VID-12). */
  triggers: ReadonlySet<NodeId>;
  /** The node drawn left of the level, wired to it; null on the main flow. */
  hub: Hub | null;
}

/** The open node, drawn as the parent of its level. */
export interface Hub {
  node: FlowNode;
  /** False on the top of a project: the root folder has no node in the graph. */
  inGraph: boolean;
}

/** The ID of the hub on the top of a project. */
export const ROOT_HUB = "hub:root";

const NO_TRIGGERS: ReadonlySet<NodeId> = new Set();

/**
 * The nodes and wires visible at one level: the top level (`null`) or the
 * direct children of `containerId` (CORE-03, 08, 09, 10, 13). The top level of
 * a snippet is the main flow (VID-10, 11, 12). On a project graph, the top and
 * folder levels lift `imports` wires and a file level lifts `calls` wires
 * (PROJ-02, 03, 04). Every level but the main flow gets the open node as its
 * hub, wired to the nodes no other wire reaches.
 */
export function projectLevel(graph: Graph, containerId: NodeId | null): Level {
  if (containerId === null && !graph.project) return mainFlow(graph);
  const level = innerLevel(graph, containerId);
  const hub = hubOf(graph, containerId);
  if (!hub) return { ...level, hub: null };
  return {
    ...level,
    edges: [...hubWires(hub.node.id, level.nodes, level.edges), ...level.edges],
    hub,
  };
}

function innerLevel(
  graph: Graph,
  containerId: NodeId | null,
): Omit<Level, "hub"> {
  const children = graph.nodes.filter((n) => n.parentId === containerId);
  if (graph.project) {
    const kind = containerId === null ? "folder" : kindOf(graph, containerId);
    if (kind === "folder") {
      const visible = new Set(children.map((n) => n.id));
      return {
        nodes: children,
        edges: lifted(graph, visible, "imports"),
        triggers: NO_TRIGGERS,
      };
    }
    if (kind === "file") {
      // Loose code with no call only sets names: it shows in the file's panel.
      const nodes = children.filter(
        (n) =>
          n.kind !== "module" ||
          n.syntaxError !== undefined ||
          hasCommands(graph, n.id),
      );
      const visible = new Set(nodes.map((n) => n.id));
      return {
        nodes,
        edges: lifted(graph, visible, "calls"),
        triggers: NO_TRIGGERS,
      };
    }
  }
  const visible = new Set(children.map((n) => n.id));
  const edges = graph.edges.filter(
    (e) => e.kind !== "calls" && visible.has(e.source) && visible.has(e.target),
  );
  return { nodes: children, edges, triggers: NO_TRIGGERS };
}

/** The open node, or a folder named after the project on its top. */
function hubOf(graph: Graph, containerId: NodeId | null): Hub | null {
  if (containerId === null) {
    const name = graph.project?.name ?? "";
    return {
      node: {
        id: ROOT_HUB,
        kind: "folder",
        label: name,
        parentId: null,
        range: { start: 1, end: 1 },
        openable: false,
        path: name,
      },
      inGraph: false,
    };
  }
  const node = graph.nodes.find((n) => n.id === containerId);
  return node ? { node, inGraph: true } : null;
}

/**
 * The `contains` wires of a level: from the hub to each node no wire reaches,
 * then to the first node, in code order, of each cycle still out of reach.
 */
function hubWires(
  hubId: NodeId,
  nodes: FlowNode[],
  edges: FlowEdge[],
): FlowEdge[] {
  const next = new Map<NodeId, NodeId[]>();
  for (const e of edges) {
    next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
  }
  const into = new Set(edges.map((e) => e.target));
  const reached = new Set<NodeId>();
  const reach = (start: NodeId) => {
    const stack = [start];
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      if (reached.has(id)) continue;
      reached.add(id);
      stack.push(...(next.get(id) ?? []));
    }
  };
  const wires: FlowEdge[] = [];
  for (const n of [...nodes.filter((n) => !into.has(n.id)), ...nodes]) {
    if (reached.has(n.id)) continue;
    wires.push({
      id: `contains:${hubId}->${n.id}`,
      kind: "contains",
      source: hubId,
      target: n.id,
    });
    reach(n.id);
  }
  return wires;
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
  return {
    nodes,
    edges,
    rows,
    triggers: new Set(main.map((r) => r.trigger)),
    hub: null,
  };
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
