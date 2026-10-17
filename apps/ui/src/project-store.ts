import type {
  FileDetail,
  FlowEdge,
  FlowNode,
  Graph,
  NodeId,
  ProjectSkeleton,
} from "@8n8/model";

/** The graph of an open folder, built from its skeleton and the files the viewer has opened. */
export interface ProjectStore {
  /** The skeleton and every loaded file as one graph; the same object until a file loads. */
  getGraph(): Graph;
  /** The source of each loaded file, by path; a new map each time a file loads. */
  getSources(): ReadonlyMap<string, string>;
  /** The file a `call` of a loaded file reaches, when it is another file. */
  refOf(nodeId: NodeId): string | undefined;
  /** The files whose request failed, even after the retry; a new set each time it changes. */
  getFailed(): ReadonlySet<string>;
  /** Loads a file once; true when it is in the store, false when it cannot be (stale or failed). A failed file is asked again. */
  ensureFile(path: string): Promise<boolean>;
  /** The files the screen needs now: loading another file never drops them. */
  keep(paths: readonly string[]): void;
  /** Another request found the skeleton old: the folder opens again, once. */
  reportStale(): void;
  subscribe(listener: () => void): () => void;
}

export interface ProjectStoreOptions {
  skeleton: ProjectSkeleton;
  fetchFile: (
    path: string,
  ) => Promise<{ status: "ok"; detail: FileDetail } | { status: "stale" }>;
  /** The folder changed since the skeleton was built: the screen opens it again. Called once. */
  onStale: () => void;
  /** The most nodes the loaded files may add up to before the least recent ones are dropped. */
  maxNodes?: number;
}

/** The pause before the one retry of a file request that failed. */
const RETRY_MS = 400;

/**
 * The default limit of loaded nodes. A loaded file costs about 150 KB of browser heap
 * (measured on a 0.8 MB file of a real project); 30 000 nodes keep the loaded files
 * in the tens of megabytes, and the biggest file seen stays well under it.
 */
export const MAX_LOADED_NODES = 30_000;

export function createProjectStore({
  skeleton,
  fetchFile,
  onStale,
  maxNodes = MAX_LOADED_NODES,
}: ProjectStoreOptions): ProjectStore {
  // Map order is the order of use: the first entry is the least recent file.
  const details = new Map<string, FileDetail>();
  const asked = new Map<string, Promise<boolean>>();
  const refs = new Map<NodeId, string>();
  const listeners = new Set<() => void>();
  let sources: ReadonlyMap<string, string> = new Map();
  let failed: ReadonlySet<string> = new Set();
  let kept: ReadonlySet<string> = new Set();
  let merged: Graph | null = null;
  const notify = () => {
    for (const l of listeners) l();
  };
  const setFailed = (path: string, on: boolean) => {
    if (failed.has(path) === on) return;
    const next = new Set(failed);
    if (on) next.add(path);
    else next.delete(path);
    failed = next;
    notify();
  };
  /** Drops the least recent files, never the kept ones nor `current`, until the nodes fit the limit. */
  function evict(current: string): boolean {
    let total = 0;
    for (const d of details.values()) total += d.nodes.length;
    let dropped = false;
    for (const [path, d] of details) {
      if (total <= maxNodes) break;
      if (path === current || kept.has(path)) continue;
      total -= d.nodes.length;
      details.delete(path);
      asked.delete(path);
      for (const id of Object.keys(d.refs)) refs.delete(id);
      const rest = new Map(sources);
      rest.delete(path);
      sources = rest;
      dropped = true;
    }
    return dropped;
  }
  let stale = false;
  const markStale = () => {
    if (stale) return;
    stale = true;
    onStale();
  };

  function build(): Graph {
    const nodes: FlowNode[] = [...skeleton.graph.nodes];
    const edges: FlowEdge[] = [...skeleton.graph.edges];
    for (const d of details.values()) {
      // The skeleton keeps the `file` node: it carries the size the level shows.
      for (const n of d.nodes) if (n.kind !== "file") nodes.push(n);
      edges.push(...d.edges);
    }
    return { ...skeleton.graph, nodes, edges };
  }

  return {
    getGraph: () => {
      merged ??= build();
      return merged;
    },
    getSources: () => sources,
    getFailed: () => failed,
    refOf: (nodeId) => refs.get(nodeId),
    keep(paths) {
      kept = new Set(paths);
    },
    ensureFile(path) {
      const known = asked.get(path);
      if (known) {
        // Asking for a loaded file uses it: it moves to the end of the order.
        const d = details.get(path);
        if (d) {
          details.delete(path);
          details.set(path, d);
        }
        return known;
      }
      setFailed(path, false);
      // One more try after a pause: a brief failure should not leave the file loading until the next need.
      const attempt = () =>
        fetchFile(path).catch(
          () =>
            new Promise<Awaited<ReturnType<typeof fetchFile>>>(
              (resolve, reject) =>
                setTimeout(
                  () => fetchFile(path).then(resolve, reject),
                  RETRY_MS,
                ),
            ),
        );
      const loading = attempt().then(
        (r) => {
          if (r.status === "stale") {
            markStale();
            return false;
          }
          details.set(path, r.detail);
          for (const [id, file] of Object.entries(r.detail.refs)) {
            refs.set(id, file);
          }
          sources = new Map(sources).set(path, r.detail.source);
          evict(path);
          merged = null;
          notify();
          return true;
        },
        () => {
          // The screen shows the failure with a button; the button asks again.
          asked.delete(path);
          setFailed(path, true);
          return false;
        },
      );
      asked.set(path, loading);
      return loading;
    },
    reportStale: markStale,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
