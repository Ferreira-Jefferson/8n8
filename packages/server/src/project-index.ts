import type {
  FlowEdge,
  FlowNode,
  LineRange,
  NodeId,
  ProjectResponse,
} from "@8n8/model";

export type ProjectRead =
  | { kind: "ok"; root: string; response: ProjectResponse }
  | { kind: "not-found"; dependency?: true };

/** What a request asks again and again about a project, built in one pass over its graph. */
export interface ProjectIndex {
  byId: Map<NodeId, FlowNode>;
  /** The path of the file a node lives in; "" when it lives in none. */
  filePathOf: (id: NodeId) => string;
  /** The source of each file, by path. */
  sources: Map<string, string>;
  /** The docstrings of every node in a file, by path, in the order of the graph. */
  docstrings: Map<string, LineRange[]>;
  /** Targets of the outgoing `calls` edges, by source node, in the order of the graph. */
  callsOut: Map<NodeId, NodeId[]>;
  /** Sources of the incoming `calls` edges, by target node, in the order of the graph. */
  callsIn: Map<NodeId, NodeId[]>;
}

/** The `calls` edges by source and by target, in the order of the graph. */
export function callMapsOf(edges: readonly FlowEdge[]): {
  callsOut: Map<NodeId, NodeId[]>;
  callsIn: Map<NodeId, NodeId[]>;
} {
  const callsOut = new Map<NodeId, NodeId[]>();
  const callsIn = new Map<NodeId, NodeId[]>();
  for (const e of edges) {
    if (e.kind !== "calls") continue;
    push(callsOut, e.source, e.target);
    push(callsIn, e.target, e.source);
  }
  return { callsOut, callsIn };
}

type Found = Extract<ProjectRead, { kind: "ok" }>;

const indexes = new WeakMap<Found, ProjectIndex>();

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** The index of a project read; the cache hands back the same read while the files hold, so the index is made once. */
export function indexOf(read: Found): ProjectIndex {
  const found = indexes.get(read);
  if (found) return found;
  const { graph, files } = read.response;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const paths = new Map<NodeId, string>();
  // Walks up to the enclosing file once per branch: every node on the way shares the answer.
  const filePathOf = (id: NodeId): string => {
    const known = paths.get(id);
    if (known !== undefined) return known;
    const trail: NodeId[] = [];
    let path = "";
    let current = byId.get(id);
    while (current) {
      const seen = paths.get(current.id);
      if (seen !== undefined) {
        path = seen;
        break;
      }
      trail.push(current.id);
      if (current.kind === "file") {
        path = current.path ?? "";
        break;
      }
      current =
        current.parentId === null ? undefined : byId.get(current.parentId);
    }
    for (const t of trail) paths.set(t, path);
    return path;
  };
  const docstrings = new Map<string, LineRange[]>();
  for (const n of graph.nodes) {
    if (n.docstring) push(docstrings, filePathOf(n.id), n.docstring);
  }
  const { callsOut, callsIn } = callMapsOf(graph.edges);
  const index: ProjectIndex = {
    byId,
    filePathOf,
    sources: new Map(files.map((f) => [f.path, f.source])),
    docstrings,
    callsOut,
    callsIn,
  };
  indexes.set(read, index);
  return index;
}
