import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { linkProject } from "@8n8/links";
import {
  type FlowEdge,
  type FlowNode,
  fileId,
  folderId,
  type Graph,
  type IgnoredFile,
  type LanguageAnalysis,
  type LanguagePlugin,
  type LinkRequest,
  type NodeId,
  type Offer,
  SEARCHABLE_KINDS,
  type SourceFile,
  searchText,
  shownInFile,
} from "@8n8/model";
import {
  failAnalysis,
  languageOf,
  layoutProject,
  manifestPlugin,
  pluginForPath,
  validateFileGraph,
  validateLinks,
  validateWires,
} from "@8n8/project";
import {
  type CrossCall,
  type FileUnit,
  fileOfId,
  type StoreParts,
} from "./project-store";

// A project is packed one file at a time (`packFile`, in the thread that analyzed the file: the analysis
// workers pack in parallel, and their graphs never cross a thread), and the pieces join at the end (`assemble`).

/** What packing a file needs to know of the project: the paths of all its files. */
export interface PackContext {
  paths: ReadonlySet<string>;
}

/** An edge the record of a file does not hold: it leaves the file, or it is an `imports` edge, which the skeleton needs. */
export interface OtherEdge {
  /** Its place among the edges of the graph of its file. */
  i: number;
  edge: FlowEdge;
  /** Whether the record holds it too (an `imports` edge with both ends in the file). */
  stored: boolean;
}

/** One file, packed and with what the join needs of it. Plain data and a buffer: it crosses a thread cheaply. */
export interface PackedFile {
  path: string;
  /** SHA-1 of the text of the file. */
  hash: string;
  lines: number;
  bytes: number;
  /**
   * gzip of the JSON of a `FileRecord`, in a buffer of its own: two gzip members that read as one text.
   * The first (`headBytes` long) holds the source; the rest holds what the plugin derived from it.
   */
  blob: Uint8Array;
  headBytes: number;
  /** The `file` node as the plugin made it. */
  fileNode: FlowNode;
  /** How many nodes are direct children of the file node, and how many of those the level of the file shows. */
  children: number;
  shown: number;
  nodeCount: number;
  /** How many edges the graph of the file has. */
  edgeCount: number;
  ids: NodeId[];
  /** The search entries of the nodes of the file, in the order of its nodes. */
  search: { texts: string[]; hits: string[] };
  /** Each node whose `target` lies in another file, with that target: the join checks it exists. */
  refTargets: [NodeId, NodeId][];
  others: OtherEdge[];
  /** Ids that start with `link:` among the edges the record holds: a wire between languages must not repeat one. */
  linkIds: string[];
}

/** The analysis of some files of one language, packed. */
export interface PackedAnalysis {
  files: PackedFile[];
  imports: FlowEdge[];
  offers: Offer[];
  requests: LinkRequest[];
}

/** The lines of a text, as a split on `\r?\n` counts them (none for an empty text), without making an array of them. */
export function lineCount(text: string): number {
  if (text === "") return 0;
  let lines = 1;
  for (
    let at = text.indexOf("\n");
    at !== -1;
    at = text.indexOf("\n", at + 1)
  ) {
    lines++;
  }
  return lines;
}

/** The first gzip member of a blob: the start of the JSON of a `FileRecord`, with the source. */
export function blobHead(source: string): Uint8Array {
  return gzipSync(`{"source":${JSON.stringify(source)}`, { level: 1 });
}

/** The folders a path lies in, from the top: the ancestors of its file node. */
function folderChain(path: string): NodeId[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => folderId(parts.slice(0, i + 1).join("/")));
}

/** Packs the graph of one file. Checks what needs nothing from the other files, so a plugin bug names its file. */
export function packFile(
  plugin: Pick<LanguagePlugin, "id">,
  ctx: PackContext,
  path: string,
  source: string,
  graph: Graph,
): PackedFile {
  const idSet = validateFileGraph(plugin, path, source, graph);
  const { nodes } = graph;
  const head = nodes[0] as FlowNode;
  // A request reads the file of a node in its id, so the ids must say it.
  const prefix = `${head.id}/`;
  for (const n of nodes) {
    if (n !== head && !n.id.startsWith(prefix)) {
      failAnalysis(
        plugin,
        path,
        `node ${n.id} does not carry the id of its file ${head.id}`,
      );
    }
  }

  // Each edge stays in the record when both its ends are in the file; the others go to the join.
  const kept: FlowEdge[] = [];
  const seqs: number[] = [];
  const others: OtherEdge[] = [];
  const linkIds: string[] = [];
  graph.edges.forEach((e, i) => {
    const inside =
      fileOfId(e.source, ctx.paths) === path &&
      fileOfId(e.target, ctx.paths) === path;
    if (!inside) {
      others.push({ i, edge: e, stored: false });
      return;
    }
    kept.push(e);
    seqs.push(i);
    if (e.id.startsWith("link:")) linkIds.push(e.id);
    if (e.kind === "imports") others.push({ i, edge: e, stored: true });
  });
  validateWires(
    plugin,
    kept.map((e): [string, FlowEdge] => [path, e]),
    idSet,
  );

  const refTargets: [NodeId, NodeId][] = [];
  for (const n of nodes) {
    if (n.target === undefined) continue;
    const there = fileOfId(n.target, ctx.paths);
    if (there !== "" && there !== path) refTargets.push([n.id, n.target]);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const folders = folderChain(path);
  const texts: string[] = [];
  const hits: string[] = [];
  for (const node of nodes) {
    if (!SEARCHABLE_KINDS.has(node.kind)) continue;
    const inside: NodeId[] = [];
    for (
      let parent = node.parentId === null ? undefined : byId.get(node.parentId);
      parent;
      parent = parent.parentId === null ? undefined : byId.get(parent.parentId)
    ) {
      inside.unshift(parent.id);
    }
    texts.push(searchText(node));
    hits.push(JSON.stringify({ node, ancestry: [...folders, ...inside] }));
  }

  const children = nodes.filter((c) => c.parentId === head.id);
  // Level 1: the JSON repeats its keys, so it shrinks a lot even so, and the build waits for it.
  // The two members are the same text as one `JSON.stringify({ source, nodes, edges, seqs })`; the second
  // holds no source, so the analysis cache keeps it alone. The copy gives the blob a buffer of its own, which a worker can hand over.
  const first = blobHead(source);
  const second = gzipSync(
    `,"nodes":${JSON.stringify(nodes)},"edges":${JSON.stringify(kept)},"seqs":${JSON.stringify(seqs)}}`,
    { level: 1 },
  );
  const blob = new Uint8Array(first.length + second.length);
  blob.set(first);
  blob.set(second, first.length);
  return {
    path,
    hash: createHash("sha1").update(source).digest("hex"),
    lines: lineCount(source),
    bytes: Buffer.byteLength(source),
    blob,
    headBytes: first.length,
    fileNode: head,
    children: children.length,
    shown: children.filter((c) => shownInFile(nodes, c)).length,
    nodeCount: nodes.length,
    edgeCount: graph.edges.length,
    ids: [...idSet],
    search: { texts, hits },
    refTargets,
    others,
    linkIds,
  };
}

/** Packs what a plugin returned for `files`; a file it was not given, or gave twice, is an error. */
export function packAnalysis(
  plugin: Pick<LanguagePlugin, "id">,
  ctx: PackContext,
  files: readonly SourceFile[],
  analysis: LanguageAnalysis,
): PackedAnalysis {
  const sources = new Map(files.map((f) => [f.path, f.source]));
  const seen = new Set<string>();
  return {
    files: analysis.files.map(({ path, graph }) => {
      const source = sources.get(path);
      if (source === undefined) {
        failAnalysis(plugin, path, "a file it was not given");
      }
      if (seen.has(path)) failAnalysis(plugin, path, "the file appears twice");
      seen.add(path);
      return packFile(plugin, ctx, path, source, graph);
    }),
    imports: analysis.imports,
    offers: analysis.offers,
    requests: analysis.requests,
  };
}

/** What one language gave: the files in the order the plugin returned them, and the ones it could not read. */
export interface GroupResult {
  plugin: LanguagePlugin;
  packed: PackedFile[];
  /** A file node with a syntax error and nothing inside (2.3). */
  failed: PackedFile[];
  imports: FlowEdge[];
  offers: Offer[];
  requests: LinkRequest[];
}

export interface AssembleInput {
  name: string;
  files: SourceFile[];
  ignored: IgnoredFile[];
  version: string;
  groups: GroupResult[];
  /** Every plugin of the server, for the language of the graph. */
  plugins: LanguagePlugin[];
}

/** A wire in the order of the whole graph. */
interface Wire {
  edge: FlowEdge;
  seq: number;
  /** The file whose record holds it already; undefined for the ones the record does not hold. */
  stored: string | undefined;
}

/**
 * Joins the packed files of the languages into what the server keeps: validates the wires between files,
 * lays the folders out, links the languages, and makes the skeleton, the search index and the call index.
 * The same files and plugins give the same parts, in a worker thread or in the main one.
 */
export function assemble(input: AssembleInput): StoreParts {
  const { groups } = input;
  // A manifest (package.json) was context for its plugin: it is no file of the map.
  const files = input.files.filter(
    (f) =>
      pluginForPath(f.path, input.plugins) !== undefined ||
      manifestPlugin(f.path, input.plugins) === undefined,
  );
  const paths = new Set(files.map((f) => f.path));
  const everyPacked = groups.flatMap((g) => [...g.packed, ...g.failed]);
  const byPath = new Map(everyPacked.map((f) => [f.path, f]));
  for (const f of files) {
    if (!byPath.has(f.path)) {
      const plugin = groups.find((g) =>
        pluginForPath(f.path, [g.plugin]),
      )?.plugin;
      if (plugin) failAnalysis(plugin, f.path, "no graph for this file");
    }
  }

  // Every end of every wire and every offer or request is a node of its language.
  const allIds = new Set<NodeId>();
  for (const g of groups) {
    const groupIds = new Set(g.packed.flatMap((f) => f.ids));
    validateWires(
      g.plugin,
      [
        ...g.packed.flatMap((f) =>
          f.others.map((o): [string, FlowEdge] => [f.path, o.edge]),
        ),
        ...g.imports.map((e): [string, FlowEdge] => ["imports", e]),
      ],
      groupIds,
    );
    validateLinks(g.plugin, [...g.offers, ...g.requests], groupIds);
    for (const f of [...g.packed, ...g.failed]) {
      for (const id of f.ids) {
        if (allIds.has(id)) throw new Error(`duplicate node id: ${id}`);
        allIds.add(id);
      }
    }
  }

  // The graph has the edges of the files, in the order of the languages and of the files, then the imports.
  const base = new Map<string, number>();
  let fileEdges = 0;
  for (const f of everyPacked) {
    base.set(f.path, fileEdges);
    fileEdges += f.edgeCount;
  }
  const imports = new Map<string, FlowEdge>();
  for (const g of groups) {
    for (const e of g.imports) if (!imports.has(e.id)) imports.set(e.id, e);
  }
  const wires: Wire[] = [];
  const known = new Set<string>();
  for (const g of groups) {
    for (const f of g.packed) {
      for (const id of f.linkIds) known.add(id);
      for (const o of f.others) {
        known.add(o.edge.id);
        wires.push({
          edge: o.edge,
          seq: (base.get(f.path) as number) + o.i,
          stored: o.stored ? f.path : undefined,
        });
      }
    }
  }
  let seq = fileEdges;
  for (const e of imports.values()) {
    known.add(e.id);
    wires.push({ edge: e, seq: seq++, stored: undefined });
  }

  // Wires between languages (D3, D4).
  const { layout, fileIds } = layoutOf(everyPacked);
  const offers = groups.flatMap((g) => g.offers);
  const requests = groups.flatMap((g) => g.requests);
  const { edges: links } = linkProject({
    offers,
    requests,
    nodes: linkNodes(offers, requests, layout, paths),
  });
  for (const e of links) {
    if (known.has(e.id)) continue;
    wires.push({ edge: e, seq: seq++, stored: undefined });
  }

  // A call between files goes to the small index; a wire inside a file that its record does not hold goes to the file.
  const cross: CrossCall[] = [];
  const extras = new Map<string, { edges: FlowEdge[]; seqs: number[] }>();
  for (const { edge: e, seq: place, stored } of wires) {
    const from = fileOfId(e.source, paths);
    if (from !== "" && from === fileOfId(e.target, paths)) {
      if (stored !== undefined) continue;
      const extra = extras.get(from);
      if (extra) {
        extra.edges.push(e);
        extra.seqs.push(place);
      } else extras.set(from, { edges: [e], seqs: [place] });
    } else if (e.kind === "calls") {
      cross.push({ seq: place, source: e.source, target: e.target });
    }
  }

  // The skeleton: the folders and the files, and the wires between files, one per pair of files and kind.
  const nodes: FlowNode[] = [];
  const skeletonEdges = new Map<string, FlowEdge>();
  for (const n of layout) {
    if (n.kind === "folder") nodes.push(n);
    if (n.kind !== "file") continue;
    const packed = byPath.get(n.path ?? "") as PackedFile;
    nodes.push({
      ...n,
      openable: n.openable && packed.children > 0,
      size: packed.shown,
    });
  }
  for (const { edge: e } of wires) {
    if (e.kind === "imports") {
      skeletonEdges.set(e.id, e);
      continue;
    }
    if (e.kind !== "calls" && e.kind !== "extends") continue;
    const from = fileIds.get(fileOfId(e.source, paths));
    const to = fileIds.get(fileOfId(e.target, paths));
    if (from === undefined || to === undefined || from === to) continue;
    const id = `${e.kind}:${from}->${to}`;
    if (skeletonEdges.has(id)) continue;
    skeletonEdges.set(id, {
      id,
      kind: e.kind,
      source: from,
      target: to,
      ...(e.label === undefined ? {} : { label: e.label }),
      ...(e.labelKey === undefined ? {} : { labelKey: e.labelKey }),
    });
  }

  // The search entries, in the order of the graph: a folder, its folders, its files with what is inside them.
  const folderById = new Map(
    layout.filter((n) => n.kind === "folder").map((n) => [n.id, n]),
  );
  const texts: string[] = [];
  const hits: string[] = [];
  for (const n of layout) {
    if (n.kind === "file") {
      const { search } = byPath.get(n.path ?? "") as PackedFile;
      for (const text of search.texts) texts.push(text);
      for (const hit of search.hits) hits.push(hit);
    } else if (SEARCHABLE_KINDS.has(n.kind)) {
      const ancestry: NodeId[] = [];
      for (
        let parent =
          n.parentId === null ? undefined : folderById.get(n.parentId);
        parent;
        parent =
          parent.parentId === null ? undefined : folderById.get(parent.parentId)
      ) {
        ancestry.unshift(parent.id);
      }
      texts.push(searchText(n));
      hits.push(JSON.stringify({ node: n, ancestry }));
    }
  }

  const folders = layout.filter((n) => n.kind === "folder");
  const totalNodes =
    folders.length + everyPacked.reduce((n, f) => n + f.nodeCount, 0);
  // The edges of the graph: the ones of the files, the imports, and the links that were new.
  const stats = {
    files: everyPacked.length,
    nodes: totalNodes,
    edges: seq,
  };
  const empty = totalNodes === 0;
  const language = languageOf(
    groups.map((g) => g.plugin),
    input.plugins,
  );

  const units: FileUnit[] = everyPacked.map((f) => {
    const refs: Record<NodeId, string> = {};
    for (const [id, target] of f.refTargets) {
      if (allIds.has(target)) refs[id] = fileOfId(target, paths);
    }
    const extra = extras.get(f.path);
    return {
      path: f.path,
      hash: f.hash,
      blob: f.blob,
      seqBase: base.get(f.path) as number,
      ...(Object.keys(refs).length > 0 ? { refs: JSON.stringify(refs) } : {}),
      ...(extra ? { extra: JSON.stringify(extra) } : {}),
    };
  });

  let lines = 0;
  let bytes = 0;
  for (const f of files) {
    const packed = byPath.get(f.path);
    lines += packed ? packed.lines : lineCount(f.source);
    bytes += packed ? packed.bytes : Buffer.byteLength(f.source);
  }
  return {
    name: input.name,
    version: input.version,
    ignored: input.ignored,
    skeleton: JSON.stringify({
      name: input.name,
      ignored: input.ignored,
      stats,
      version: input.version,
      graph: {
        language,
        empty,
        project: { name: input.name },
        nodes,
        edges: [...skeletonEdges.values()],
      },
    }),
    counts: {
      lines,
      bytes,
      files: files.length,
      nodes: stats.nodes,
      edges: stats.edges,
    },
    empty,
    folders,
    files: units,
    cross,
    search: { texts, hits },
  };
}

/** The folders and the files in the order of the graph, and the id of the file node of each path. */
function layoutOf(packed: readonly PackedFile[]): {
  layout: FlowNode[];
  fileIds: Map<string, NodeId>;
} {
  const heads = new Map<string, Graph>();
  const fileIds = new Map<string, NodeId>();
  for (const f of packed) {
    heads.set(f.path, {
      language: "",
      empty: false,
      nodes: [f.fileNode],
      edges: [],
    });
    fileIds.set(f.path, f.fileNode.id);
  }
  return { layout: layoutProject(heads), fileIds };
}

/** The nodes the linker needs to find the file of an offer or a request: the files, and each node an offer or a request names. */
function linkNodes(
  offers: readonly Offer[],
  requests: readonly LinkRequest[],
  layout: readonly FlowNode[],
  paths: ReadonlySet<string>,
): FlowNode[] {
  const nodes = layout.filter((n) => n.kind === "file");
  const named = new Set<NodeId>();
  for (const { nodeId } of [...offers, ...requests]) {
    const path = fileOfId(nodeId, paths);
    if (path === "" || named.has(nodeId)) continue;
    named.add(nodeId);
    nodes.push({
      id: nodeId,
      kind: "code",
      label: nodeId,
      parentId: fileId(path),
      range: { start: 1, end: 1 },
      openable: false,
    });
  }
  return nodes;
}
