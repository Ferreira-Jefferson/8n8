import { gunzipSync } from "node:zlib";
import type {
  FileDetail,
  FlowEdge,
  FlowNode,
  IgnoredFile,
  LineRange,
  NodeId,
  SearchHit,
} from "@8n8/model";
import { searchWords } from "@8n8/model";

/**
 * What the server keeps of a folder it built: the top of the map as ready JSON, a small index and the
 * inside of each file packed. The full graph is never kept: a request unpacks the files it needs.
 */
export interface ProjectStore {
  name: string;
  /** Names this build: the file requests carry it, and a folder that changed answers 409. */
  version: string;
  ignored: IgnoredFile[];
  /** What the history keeps of the project. */
  counts: ProjectCounts;
  /** The plugins found nothing to map: the history keeps no such project. */
  empty: boolean;
  /** The JSON of the `ProjectSkeleton`, made once: the route sends it as it is. */
  skeleton: string;
  /** The paths of the files of the project. */
  paths: string[];
  /** The path of the file a node lives in; "" for a folder and for an unknown id. It reads the id, not the graph. */
  filePathOf: (id: NodeId) => string;
  /** The node with this id, from the folder list or from the file it lives in. */
  nodeOf: (id: NodeId) => FlowNode | undefined;
  /** The source of a file; `undefined` for a path the project does not have. */
  sourceOf: (path: string) => string | undefined;
  /** The lines of the documentation comments of every node in a file, in the order of the graph. */
  docstringsOf: (path: string) => LineRange[];
  /** Targets of the outgoing `calls` edges of a node, and sources of the incoming ones, in the order of the graph. */
  callsOf: (id: NodeId) => { out: NodeId[]; in: NodeId[] };
  /** The inside of one file; `undefined` when the project has no such file. */
  detailOf: (path: string) => FileDetail | undefined;
  /** The nodes of the whole folder whose name holds every word of `query`, in the order of the graph. */
  search: (query: string, limit: number) => SearchHit[];
}

export type ProjectRead =
  | { kind: "ok"; root: string; project: ProjectStore }
  | { kind: "not-found"; dependency?: true };

/** What the history keeps of a project: the sizes of its code and of its graph. */
export interface ProjectCounts {
  lines: number;
  bytes: number;
  files: number;
  nodes: number;
  edges: number;
}

/** One file of the project, packed. The unit never depends on another file, so a later stage can keep it between builds by `hash`. */
export interface FileUnit {
  path: string;
  /** SHA-1 of the text of the file. */
  hash: string;
  /** gzip of the JSON of a `FileRecord`. */
  blob: Uint8Array;
  /** JSON of the file of each node whose `target` lies in another file; absent when none does. */
  refs?: string;
}

/** What is inside a packed file. */
export interface FileRecord {
  source: string;
  /** The `file` node and all its descendants, in the order of the graph. */
  nodes: FlowNode[];
  /** Only the edges with both ends in the file, in the order of the graph. */
  edges: FlowEdge[];
  /** For each of `edges`, its place in the edges of the whole graph. */
  seqs: number[];
}

/** A `calls` edge between two files: its place in the whole graph, and its ends. */
export interface CrossCall {
  seq: number;
  source: NodeId;
  target: NodeId;
}

/** Everything a store needs, made by `compactProject`: plain data and buffers that cross a thread without cost. */
export interface StoreParts {
  name: string;
  version: string;
  ignored: IgnoredFile[];
  skeleton: string;
  counts: ProjectCounts;
  empty: boolean;
  folders: FlowNode[];
  files: FileUnit[];
  cross: CrossCall[];
  search: { texts: string[]; hits: string[] };
}

/**
 * The path of the file a node id lives in: ids are `file:<path>` or `file:<path>/<inside>`. Takes the
 * longest prefix that is a file of the project; "" for `dir:` ids and for ids no file owns.
 */
export function fileOfId(id: NodeId, files: ReadonlySet<string>): string {
  if (!id.startsWith("file:")) return "";
  let path = id.slice(5);
  for (;;) {
    if (files.has(path)) return path;
    const slash = path.lastIndexOf("/");
    if (slash < 0) return "";
    path = path.slice(0, slash);
  }
}

/** The files kept unpacked at once: a request touches a few, and a file is small once it is unpacked. */
export const OPEN_FILES = 16;

/** A file unpacked, with the small indexes a request asks for. */
interface OpenFile extends FileRecord {
  byId: Map<NodeId, FlowNode>;
  callsOut: Map<NodeId, { seq: number; id: NodeId }[]>;
  callsIn: Map<NodeId, { seq: number; id: NodeId }[]>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function open(blob: Uint8Array): OpenFile {
  const record = JSON.parse(gunzipSync(blob).toString("utf8")) as FileRecord;
  const callsOut = new Map<NodeId, { seq: number; id: NodeId }[]>();
  const callsIn = new Map<NodeId, { seq: number; id: NodeId }[]>();
  record.edges.forEach((e, i) => {
    if (e.kind !== "calls") return;
    const seq = record.seqs[i] as number;
    push(callsOut, e.source, { seq, id: e.target });
    push(callsIn, e.target, { seq, id: e.source });
  });
  return {
    ...record,
    byId: new Map(record.nodes.map((n) => [n.id, n])),
    callsOut,
    callsIn,
  };
}

/** The calls of both sources in the order of the graph. */
function inOrder(
  ...lists: ({ seq: number; id: NodeId }[] | undefined)[]
): NodeId[] {
  return lists
    .flatMap((list) => list ?? [])
    .sort((a, b) => a.seq - b.seq)
    .map((c) => c.id);
}

/** The store of a build; `openFiles` is how many files stay unpacked. */
export function createProjectStore(
  parts: StoreParts,
  openFiles = OPEN_FILES,
): ProjectStore {
  const units = new Map(parts.files.map((f) => [f.path, f]));
  const paths = new Set(units.keys());
  const folders = new Map(parts.folders.map((f) => [f.id, f]));
  const crossOut = new Map<NodeId, { seq: number; id: NodeId }[]>();
  const crossIn = new Map<NodeId, { seq: number; id: NodeId }[]>();
  for (const { seq, source, target } of parts.cross) {
    push(crossOut, source, { seq, id: target });
    push(crossIn, target, { seq, id: source });
  }
  // Most recently used goes last.
  const opened = new Map<string, OpenFile>();
  const fileOf = (path: string): OpenFile | undefined => {
    const found = opened.get(path);
    if (found) {
      opened.delete(path);
      opened.set(path, found);
      return found;
    }
    const unit = units.get(path);
    if (!unit) return undefined;
    const made = open(unit.blob);
    opened.set(path, made);
    for (const oldest of opened.keys()) {
      if (opened.size <= openFiles) break;
      opened.delete(oldest);
    }
    return made;
  };
  const filePathOf = (id: NodeId) => fileOfId(id, paths);
  const nodeOf = (id: NodeId): FlowNode | undefined => {
    const folder = folders.get(id);
    if (folder) return folder;
    const path = filePathOf(id);
    return path === "" ? undefined : fileOf(path)?.byId.get(id);
  };
  const { texts, hits } = parts.search;

  return {
    name: parts.name,
    version: parts.version,
    ignored: parts.ignored,
    counts: parts.counts,
    empty: parts.empty,
    skeleton: parts.skeleton,
    paths: [...paths],
    filePathOf,
    nodeOf,
    sourceOf: (path) => fileOf(path)?.source,
    docstringsOf: (path) =>
      (fileOf(path)?.nodes ?? []).flatMap((n) => n.docstring ?? []),
    callsOf: (id) => {
      const path = filePathOf(id);
      const file = path === "" ? undefined : fileOf(path);
      return {
        out: inOrder(file?.callsOut.get(id), crossOut.get(id)),
        in: inOrder(file?.callsIn.get(id), crossIn.get(id)),
      };
    },
    detailOf: (path) => {
      const file = fileOf(path);
      if (!file) return undefined;
      const refs = units.get(path)?.refs;
      return {
        path,
        source: file.source,
        nodes: file.nodes,
        edges: file.edges,
        refs:
          refs === undefined ? {} : (JSON.parse(refs) as FileDetail["refs"]),
      };
    },
    search: (query, limit) => {
      const words = searchWords(query);
      if (words.length === 0) return [];
      const found: SearchHit[] = [];
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i] as string;
        if (!words.every((w) => text.includes(w))) continue;
        found.push(JSON.parse(hits[i] as string) as SearchHit);
        if (found.length === limit) break;
      }
      return found;
    },
  };
}
