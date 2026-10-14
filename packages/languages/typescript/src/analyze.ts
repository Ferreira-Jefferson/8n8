import { lastLine, markSyntaxErrors } from "@code2n8n/lang-treesitter";
import {
  type FlowEdge,
  type FlowNode,
  fileId,
  folderId,
  type Graph,
  type LanguageAnalysis,
  type SourceFile,
} from "@code2n8n/model";
import type { Tree } from "web-tree-sitter";
import { buildGraph } from "./build-graph";
import { moduleSpecifiers } from "./imports";
import { collectLinks } from "./links";
import {
  buildModuleIndex,
  exportInfo,
  type ModuleIndex,
  resolveMember,
  resolveModulePath,
} from "./modules";
import { parsers } from "./parse";

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

/** The file node followed by its inner nodes; syntax errors marked per file. */
function fileGraph({ file, tree }: Parsed, index: ModuleIndex): Graph {
  const id = fileId(file.path);
  const graph = buildGraph(tree, {
    prefix: id,
    resolveImport: (binding, member) =>
      member === null ? null : resolveMember(index, file.path, binding, member),
  });
  const head: FlowNode = {
    id,
    kind: "file",
    label: baseName(file.path),
    // A file in the root has no folder: it sits at the top, beside the folders.
    parentId: dirOf(file.path) === "" ? null : folderId(dirOf(file.path)),
    // Covers every line while marking, so an error outside the inner
    // nodes lands on the file node instead of a new module node.
    range: { start: 1, end: Number.MAX_SAFE_INTEGER },
    openable: true,
    path: file.path,
  };
  const marked = markSyntaxErrors(
    tree,
    { ...graph, nodes: [head, ...graph.nodes] },
    `${id}/mod`,
  );
  const [fileNode, ...inner] = marked.nodes;
  return {
    ...marked,
    empty: false,
    nodes: [
      {
        ...(fileNode ?? head),
        range: { start: 1, end: lastLine(file.source) },
      },
      ...inner,
    ],
  };
}

/** One `imports` wire per (file, file) pair, in code order. */
function importsEdges(parsed: Parsed[], index: ModuleIndex): FlowEdge[] {
  const edges = new Map<string, FlowEdge>();
  for (const { file, tree } of parsed) {
    for (const specifier of moduleSpecifiers(tree.rootNode)) {
      const target = resolveModulePath(file.path, specifier, index);
      if (target === null || target === file.path) continue;
      const source = fileId(file.path);
      const to = fileId(target);
      const id = `imports:${source}->${to}`;
      if (!edges.has(id))
        edges.set(id, { id, kind: "imports", source, target: to });
    }
  }
  return [...edges.values()];
}

/**
 * Reads a set of TypeScript files: one graph per file, the `imports` wires
 * between them, and what each file offers and requests to other languages.
 */
export function analyzeFiles(files: SourceFile[]): LanguageAnalysis {
  const parsed: Parsed[] = [];
  try {
    for (const file of [...files].sort((a, b) => byCode(a.path, b.path))) {
      const parser = file.path.endsWith(".tsx")
        ? parsers.tsx
        : parsers.typescript;
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
    const result: LanguageAnalysis = {
      files: [],
      imports: importsEdges(parsed, index),
      offers: [],
      requests: [],
    };
    for (const p of parsed) {
      const graph = fileGraph(p, index);
      const { offers, requests } = collectLinks(
        p.file.path,
        p.tree.rootNode,
        graph,
        exportInfo(p.tree.rootNode),
      );
      result.files.push({ path: p.file.path, graph });
      result.offers.push(...offers);
      result.requests.push(...requests);
    }
    return result;
  } finally {
    for (const { tree } of parsed) tree.delete();
  }
}
