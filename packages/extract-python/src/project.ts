import {
  type FlowEdge,
  type FlowNode,
  fileId,
  folderId,
  type Graph,
  type NodeId,
  type SourceFile,
} from "@code2n8n/model";
import type { Parser, Tree } from "web-tree-sitter";
import { allocateTopLevel, buildGraph } from "./build-graph";
import { markSyntaxErrors } from "./errors";
import { buildModuleIndex, type ModuleIndex, resolveName } from "./modules";

interface Parsed {
  file: SourceFile;
  tree: Tree;
}

function byCode(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function dirOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

function lastLine(source: string): number {
  const lines = source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
  return Math.max(1, lines);
}

function folderNode(rel: string, parentId: NodeId | null): FlowNode {
  return {
    id: folderId(rel),
    kind: "folder",
    label: rel === "" ? "raiz" : baseName(rel),
    parentId,
    range: { start: 1, end: 1 },
    openable: true,
    path: rel,
  };
}

/** The file node followed by its inner nodes; syntax errors marked per file. */
function fileGraph(
  { file, tree }: Parsed,
  index: ModuleIndex,
  projectNames: Set<string>,
): Graph {
  const id = fileId(file.path);
  const graph = buildGraph(tree, {
    prefix: id,
    resolveImport: (full) => resolveName(index, file.path, full),
    projectNames,
  });
  const head: FlowNode = {
    id,
    kind: "file",
    label: baseName(file.path),
    parentId: folderId(dirOf(file.path)),
    // Covers every line while marking, so an error outside the inner
    // nodes lands on the file node instead of a new module node.
    range: { start: 1, end: Number.MAX_SAFE_INTEGER },
    openable: true,
    path: file.path,
  };
  const marked = markSyntaxErrors(tree, {
    ...graph,
    nodes: [head, ...graph.nodes],
  });
  const [fileNode, ...inner] = marked.nodes;
  return {
    ...marked,
    nodes: [
      {
        ...(fileNode ?? head),
        range: { start: 1, end: lastLine(file.source) },
      },
      ...inner,
    ],
  };
}

/** Folder and file nodes in pre-order, each file followed by its inner nodes. */
function layoutProject(graphs: Map<string, Graph>): FlowNode[] {
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

  if (paths.some((p) => dirOf(p) === "")) {
    nodes.push(folderNode("", null));
    emitFiles("");
  }
  for (const dir of sortedDirs) {
    if (dirOf(dir) === "") emitFolder(dir, null);
  }
  return nodes;
}

/**
 * Builds the graph of a project (PROJ-02, 04, 09): one pass indexes the
 * modules, a second builds each file under its `file:` prefix.
 */
export function extractProject(parser: Parser, files: SourceFile[]): Graph {
  const parsed: Parsed[] = [];
  try {
    for (const file of [...files].sort((a, b) => byCode(a.path, b.path))) {
      const tree = parser.parse(file.source);
      if (!tree) throw new Error(`tree-sitter could not parse ${file.path}`);
      parsed.push({ file, tree });
    }
    const index = buildModuleIndex(
      parsed.map(({ file, tree }) => ({
        path: file.path,
        root: tree.rootNode,
      })),
    );
    const projectNames = new Set(
      parsed.flatMap(({ tree }) => [
        ...allocateTopLevel(tree.rootNode).topLevel.keys(),
      ]),
    );
    const graphs = new Map(
      parsed.map((p) => [p.file.path, fileGraph(p, index, projectNames)]),
    );

    const nodes = layoutProject(graphs);
    const edges: FlowEdge[] = [...graphs.values()].flatMap((g) => g.edges);
    const seen = new Set<NodeId>();
    for (const node of nodes) {
      if (seen.has(node.id)) throw new Error(`duplicate node id: ${node.id}`);
      seen.add(node.id);
    }
    return { language: "python", empty: nodes.length === 0, nodes, edges };
  } finally {
    for (const { tree } of parsed) tree.delete();
  }
}
