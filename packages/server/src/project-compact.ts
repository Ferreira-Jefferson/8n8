import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gzip, gzipSync } from "node:zlib";
import {
  type FlowEdge,
  type FlowNode,
  type Graph,
  type IgnoredFile,
  type NodeId,
  SEARCHABLE_KINDS,
  type SourceFile,
  searchText,
  skeletonGraphOf,
} from "@8n8/model";
import {
  type CrossCall,
  type FileRecord,
  type FileUnit,
  fileOfId,
  type StoreParts,
} from "./project-store";

export interface CompactInput {
  name: string;
  files: SourceFile[];
  ignored: IgnoredFile[];
  version: string;
  /** The whole graph of the project, with the wires between languages already in it. */
  graph: Graph;
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

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** A file ready to be packed: its JSON is made and not yet compressed. */
interface Unpacked {
  path: string;
  hash: string;
  json: string;
  refs?: string;
}

// Level 1: the JSON repeats its keys, so it shrinks a lot even so, and the build waits for it.
const GZIP = { level: 1 };

const toUnit = (file: Unpacked, blob: Uint8Array): FileUnit => ({
  path: file.path,
  hash: file.hash,
  blob,
  ...(file.refs === undefined ? {} : { refs: file.refs }),
});

/** Everything of the parts but the packed files, and the files one by one, so a caller can pack them as it likes. */
function prepare(input: CompactInput): {
  rest: Omit<StoreParts, "files">;
  unpacked: () => Generator<Unpacked>;
} {
  const { graph, files } = input;
  const paths = new Set(files.map((f) => f.path));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  // The file of each node, by the walk up its parents; the ids must say the same, because a request reads the id.
  const walked = new Map<NodeId, string>();
  const filePathOf = (id: NodeId): string => {
    const known = walked.get(id);
    if (known !== undefined) return known;
    const trail: NodeId[] = [];
    let path = "";
    let current = byId.get(id);
    while (current) {
      const seen = walked.get(current.id);
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
    for (const t of trail) walked.set(t, path);
    return path;
  };

  const folders: FlowNode[] = [];
  const nodesByFile = new Map<string, FlowNode[]>();
  for (const n of graph.nodes) {
    if (n.kind === "folder") folders.push(n);
    const path = filePathOf(n.id);
    if (path === "") continue;
    if (fileOfId(n.id, paths) !== path) {
      throw new Error(
        `node ${n.id} does not carry the id of its file ${path}: a node id starts with its file's id`,
      );
    }
    push(nodesByFile, path, n);
  }

  // Each wire goes to the file of both its ends, or, for a call between files, to the small index.
  const edgesByFile = new Map<string, { edges: FlowEdge[]; seqs: number[] }>();
  const cross: CrossCall[] = [];
  graph.edges.forEach((e, seq) => {
    const path = fileOfId(e.source, paths);
    if (path !== "" && path === fileOfId(e.target, paths)) {
      const kept = edgesByFile.get(path);
      if (kept) {
        kept.edges.push(e);
        kept.seqs.push(seq);
      } else edgesByFile.set(path, { edges: [e], seqs: [seq] });
    } else if (e.kind === "calls") {
      cross.push({ seq, source: e.source, target: e.target });
    }
  });

  function* unpacked(): Generator<Unpacked> {
    for (const { path, source } of files) {
      const nodes = nodesByFile.get(path) ?? [];
      // The file of every outside target: the screen opens it when the person follows the call.
      const refs: Record<NodeId, string> = {};
      for (const n of nodes) {
        if (n.target === undefined || !byId.has(n.target)) continue;
        const there = fileOfId(n.target, paths);
        if (there !== "" && there !== path) refs[n.id] = there;
      }
      const wires = edgesByFile.get(path);
      const record: FileRecord = {
        source,
        nodes,
        edges: wires?.edges ?? [],
        seqs: wires?.seqs ?? [],
      };
      yield {
        path,
        hash: createHash("sha1").update(source).digest("hex"),
        json: JSON.stringify(record),
        ...(Object.keys(refs).length > 0 ? { refs: JSON.stringify(refs) } : {}),
      };
    }
  }

  const texts: string[] = [];
  const hits: string[] = [];
  for (const node of graph.nodes) {
    if (!SEARCHABLE_KINDS.has(node.kind)) continue;
    const ancestry: NodeId[] = [];
    for (
      let parent = node.parentId === null ? undefined : byId.get(node.parentId);
      parent;
      parent = parent.parentId === null ? undefined : byId.get(parent.parentId)
    ) {
      ancestry.unshift(parent.id);
    }
    texts.push(searchText(node));
    hits.push(JSON.stringify({ node, ancestry }));
  }

  const stats = {
    files: graph.nodes.filter((n) => n.kind === "file").length,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
  };
  return {
    unpacked,
    rest: {
      name: input.name,
      version: input.version,
      ignored: input.ignored,
      skeleton: JSON.stringify({
        name: input.name,
        ignored: input.ignored,
        stats,
        version: input.version,
        graph: skeletonGraphOf(graph),
      }),
      counts: {
        lines: files.reduce((n, f) => n + lineCount(f.source), 0),
        bytes: files.reduce((n, f) => n + Buffer.byteLength(f.source), 0),
        files: files.length,
        nodes: stats.nodes,
        edges: stats.edges,
      },
      empty: graph.empty,
      folders,
      cross,
      search: { texts, hits },
    },
  };
}

/**
 * Packs the full graph of a project into what the server keeps: the skeleton as JSON, the search index,
 * the `calls` wires between files, and each file, with its nodes and wires, as one gzip JSON.
 * Pure: the same graph gives the same parts, in a worker thread or in the main one.
 */
export function compactProject(input: CompactInput): StoreParts {
  const { rest, unpacked } = prepare(input);
  return {
    ...rest,
    files: [...unpacked()].map((file) =>
      toUnit(file, gzipSync(file.json, GZIP)),
    ),
  };
}

const gzipAsync = promisify(gzip);

/** Files compressed at the same time: the compressor works in the thread pool, off this thread. */
const COMPRESSING = 16;

/**
 * The same parts as `compactProject`, with the compression in the thread pool of the process: while a
 * batch of files compresses, this thread already makes the JSON of the next one.
 * `onFiles` gets each batch as it is ready; the parts it gives back hold the files not yet handed over.
 */
export async function compactProjectAsync(
  input: CompactInput,
  onFiles?: (batch: FileUnit[]) => void,
): Promise<StoreParts> {
  const { rest, unpacked } = prepare(input);
  const done: FileUnit[] = [];
  const settle = async (batch: Promise<FileUnit[]>) => {
    const units = await batch;
    if (onFiles) onFiles(units);
    else done.push(...units);
  };
  let flying: Promise<void> | undefined;
  let batch: Unpacked[] = [];
  const launch = () => {
    const files = batch;
    batch = [];
    return Promise.all(
      files.map(async (file) => toUnit(file, await gzipAsync(file.json, GZIP))),
    );
  };
  for (const file of unpacked()) {
    batch.push(file);
    if (batch.length < COMPRESSING) continue;
    const next = launch();
    await flying;
    flying = settle(next);
  }
  const last = launch();
  await flying;
  await settle(last);
  return { ...rest, files: done };
}
