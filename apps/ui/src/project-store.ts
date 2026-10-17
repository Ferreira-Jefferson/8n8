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
  /** Loads a file once; true when it is in the store, false when it cannot be (stale or failed). */
  ensureFile(path: string): Promise<boolean>;
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
}

/** The pause before the one retry of a file request that failed. */
const RETRY_MS = 400;

export function createProjectStore({
  skeleton,
  fetchFile,
  onStale,
}: ProjectStoreOptions): ProjectStore {
  const details = new Map<string, FileDetail>();
  const asked = new Map<string, Promise<boolean>>();
  const refs = new Map<NodeId, string>();
  const listeners = new Set<() => void>();
  let sources: ReadonlyMap<string, string> = new Map();
  let merged: Graph | null = null;
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
    refOf: (nodeId) => refs.get(nodeId),
    ensureFile(path) {
      const known = asked.get(path);
      if (known) return known;
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
          merged = null;
          for (const l of listeners) l();
          return true;
        },
        () => {
          // A failed request is asked again by the next need.
          asked.delete(path);
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
