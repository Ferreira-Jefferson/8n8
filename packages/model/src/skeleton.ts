import { shownInFile } from "./commands";
import type { FlowEdge, FlowNode, Graph, NodeId } from "./graph";

/**
 * The top of a project graph: the `folder` and `file` nodes and the wires between
 * files, with nothing from inside a file. A file carries `size`, the number of nodes
 * its level shows, and is `openable` only when it has something inside.
 *
 * The wires are every `imports` wire, and the `calls` and `extends` wires that cross
 * from one file to another, one per pair of files and kind. Such a wire has the id
 * and the label the screen gives it when it lifts the full graph to a folder level,
 * and the order of the full graph, so a folder level looks the same from either graph.
 */
export function skeletonGraphOf(graph: Graph): Graph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const paths = new Map<NodeId, string>();
  // The path of the file a node lives in, "" when none: every node on the way up shares the answer.
  const filePathOf = (id: NodeId): string => {
    const known = paths.get(id);
    if (known !== undefined) return known;
    const trail: NodeId[] = [];
    let path = "";
    for (let n = byId.get(id); n; ) {
      const seen = paths.get(n.id);
      if (seen !== undefined) {
        path = seen;
        break;
      }
      trail.push(n.id);
      if (n.kind === "file") {
        path = n.path ?? "";
        break;
      }
      n = n.parentId === null ? undefined : byId.get(n.parentId);
    }
    for (const t of trail) paths.set(t, path);
    return path;
  };

  const inFile = new Map<string, FlowNode[]>();
  const fileIds = new Map<string, NodeId>();
  for (const n of graph.nodes) {
    const path = filePathOf(n.id);
    if (path === "") continue;
    const list = inFile.get(path);
    if (list) list.push(n);
    else inFile.set(path, [n]);
    if (n.kind === "file") fileIds.set(path, n.id);
  }

  const nodes: FlowNode[] = [];
  for (const n of graph.nodes) {
    if (n.kind === "folder") nodes.push(n);
    if (n.kind !== "file") continue;
    const all = inFile.get(n.path ?? "") ?? [];
    const children = all.filter((c) => c.parentId === n.id);
    nodes.push({
      ...n,
      openable: n.openable && children.length > 0,
      size: children.filter((c) => shownInFile(all, c)).length,
    });
  }

  const edges = new Map<string, FlowEdge>();
  for (const e of graph.edges) {
    if (e.kind === "imports") {
      edges.set(e.id, e);
      continue;
    }
    if (e.kind !== "calls" && e.kind !== "extends") continue;
    const from = fileIds.get(filePathOf(e.source));
    const to = fileIds.get(filePathOf(e.target));
    if (from === undefined || to === undefined || from === to) continue;
    const id = `${e.kind}:${from}->${to}`;
    if (edges.has(id)) continue;
    edges.set(id, {
      id,
      kind: e.kind,
      source: from,
      target: to,
      ...(e.label === undefined ? {} : { label: e.label }),
      ...(e.labelKey === undefined ? {} : { labelKey: e.labelKey }),
    });
  }

  return {
    language: graph.language,
    empty: graph.empty,
    ...(graph.project ? { project: graph.project } : {}),
    nodes,
    edges: [...edges.values()],
  };
}
