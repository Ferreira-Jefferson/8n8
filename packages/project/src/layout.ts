import { type FlowNode, folderId, type Graph, type NodeId } from "@8n8/model";

export function byCode(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function dirOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

export function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function lastLine(source: string): number {
  const lines = source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
  return Math.max(1, lines);
}

export function folderNode(rel: string, parentId: NodeId | null): FlowNode {
  return {
    id: folderId(rel),
    kind: "folder",
    label: baseName(rel),
    parentId,
    range: { start: 1, end: 1 },
    openable: true,
    path: rel,
  };
}

/** Folder and file nodes in pre-order, each file followed by its inner nodes. */
export function layoutProject(graphs: Map<string, Graph>): FlowNode[] {
  const paths = [...graphs.keys()].sort(byCode);
  const dirs = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  const sortedDirs = [...dirs].sort(byCode);
  const nodes: FlowNode[] = [];
  const emitFiles = (dir: string) => {
    for (const path of paths) {
      if (dirOf(path) === dir) nodes.push(...(graphs.get(path)?.nodes ?? []));
    }
  };
  const emitFolder = (dir: string, parentId: NodeId | null) => {
    nodes.push(folderNode(dir, parentId));
    for (const sub of sortedDirs) {
      if (dirOf(sub) === dir) emitFolder(sub, folderId(dir));
    }
    emitFiles(dir);
  };

  for (const dir of sortedDirs) {
    if (dirOf(dir) === "") emitFolder(dir, null);
  }
  emitFiles("");
  return nodes;
}
