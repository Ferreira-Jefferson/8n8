import type { FileDetail, ProjectSkeleton } from "@8n8/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectStore } from "../project-store";

const skeleton = {
  name: "p",
  ignored: [],
  stats: { files: 1, nodes: 1, edges: 0 },
  version: "v1",
  graph: { language: "python", empty: false, nodes: [], edges: [] },
} as ProjectSkeleton;

const detail = (path: string): FileDetail => ({
  path,
  source: "x = 1\n",
  nodes: [],
  edges: [],
  refs: {},
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createProjectStore", () => {
  it("asks a file once and keeps its source", async () => {
    const fetchFile = vi.fn(async (path: string) => ({
      status: "ok" as const,
      detail: detail(path),
    }));
    const store = createProjectStore({ skeleton, fetchFile, onStale: vi.fn() });
    const [a, b] = await Promise.all([
      store.ensureFile("a.py"),
      store.ensureFile("a.py"),
    ]);
    expect([a, b]).toEqual([true, true]);
    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(store.getSources().get("a.py")).toBe("x = 1\n");
  });

  it("tries once more after a failed request, and loads the file", async () => {
    const fetchFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({ status: "ok", detail: detail("a.py") });
    const store = createProjectStore({ skeleton, fetchFile, onStale: vi.fn() });
    const loading = store.ensureFile("a.py");
    await vi.advanceTimersByTimeAsync(500);
    expect(await loading).toBe(true);
    expect(fetchFile).toHaveBeenCalledTimes(2);
    expect(store.getSources().has("a.py")).toBe(true);
  });

  it("gives up after the retry, and asks again at the next need", async () => {
    const fetchFile = vi.fn().mockRejectedValue(new Error("network"));
    const store = createProjectStore({ skeleton, fetchFile, onStale: vi.fn() });
    const first = store.ensureFile("a.py");
    await vi.advanceTimersByTimeAsync(500);
    expect(await first).toBe(false);
    expect(fetchFile).toHaveBeenCalledTimes(2);

    const next = store.ensureFile("a.py");
    await vi.advanceTimersByTimeAsync(500);
    expect(await next).toBe(false);
    expect(fetchFile).toHaveBeenCalledTimes(4);
  });

  it("reports a stale skeleton once, however many requests find it", async () => {
    const onStale = vi.fn();
    const store = createProjectStore({
      skeleton,
      fetchFile: async () => ({ status: "stale" as const }),
      onStale,
    });
    expect(await store.ensureFile("a.py")).toBe(false);
    expect(await store.ensureFile("b.py")).toBe(false);
    store.reportStale();
    expect(onStale).toHaveBeenCalledTimes(1);
  });
});

/** A file of `count` nodes, to make the limit count something. */
const big = (path: string, count: number): FileDetail => ({
  ...detail(path),
  nodes: Array.from({ length: count }, (_, i) => ({
    id: `${path}:${i}`,
    kind: "function",
    parentId: null,
  })) as unknown as FileDetail["nodes"],
  refs: { [`${path}:0`]: "other.py" },
});

describe("failed files", () => {
  it("marks a file that failed after the retry, in a new set each change", async () => {
    const fetchFile = vi.fn().mockRejectedValue(new Error("network"));
    const store = createProjectStore({ skeleton, fetchFile, onStale: vi.fn() });
    const before = store.getFailed();
    const listener = vi.fn();
    store.subscribe(listener);
    const loading = store.ensureFile("a.py");
    await vi.advanceTimersByTimeAsync(500);
    expect(await loading).toBe(false);
    expect(store.getFailed()).not.toBe(before);
    expect(store.getFailed().has("a.py")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getFailed()).toBe(store.getFailed());
  });

  it("clears the mark and asks again when ensureFile is called for a failed file", async () => {
    const fetchFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({ status: "ok", detail: detail("a.py") });
    const store = createProjectStore({ skeleton, fetchFile, onStale: vi.fn() });
    const first = store.ensureFile("a.py");
    await vi.advanceTimersByTimeAsync(500);
    await first;
    expect(store.getFailed().has("a.py")).toBe(true);
    const again = store.ensureFile("a.py");
    expect(store.getFailed().has("a.py")).toBe(false);
    expect(await again).toBe(true);
    expect(store.getSources().has("a.py")).toBe(true);
  });

  it("does not mark a stale answer as a failure", async () => {
    const store = createProjectStore({
      skeleton,
      fetchFile: async () => ({ status: "stale" as const }),
      onStale: vi.fn(),
    });
    await store.ensureFile("a.py");
    expect(store.getFailed().size).toBe(0);
  });
});

describe("the limit of loaded nodes", () => {
  function setup(maxNodes = 25) {
    const fetchFile = vi.fn(async (path: string) => ({
      status: "ok" as const,
      detail: big(path, 10),
    }));
    const store = createProjectStore({
      skeleton,
      fetchFile,
      onStale: vi.fn(),
      maxNodes,
    });
    return { store, fetchFile };
  }

  it("drops the least recent file when a load passes the limit", async () => {
    const { store } = setup();
    await store.ensureFile("a.py");
    await store.ensureFile("b.py");
    const graphBefore = store.getGraph();
    await store.ensureFile("c.py");
    expect([...store.getSources().keys()]).toEqual(["b.py", "c.py"]);
    expect(store.getGraph()).not.toBe(graphBefore);
    expect(store.getGraph().nodes.some((n) => n.id.startsWith("a.py"))).toBe(
      false,
    );
    expect(store.refOf("a.py:0")).toBeUndefined();
    expect(store.refOf("b.py:0")).toBe("other.py");
  });

  it("never drops a kept file, nor the file that was just asked", async () => {
    const { store } = setup();
    store.keep(["a.py"]);
    await store.ensureFile("a.py");
    await store.ensureFile("b.py");
    await store.ensureFile("c.py");
    expect([...store.getSources().keys()]).toEqual(["a.py", "c.py"]);
    store.keep(["a.py", "b.py", "c.py"]);
    await store.ensureFile("d.py");
    // Everything else is kept: the limit is passed, and the new file stays.
    expect(store.getSources().has("d.py")).toBe(true);
    expect(store.getSources().size).toBe(3);
  });

  it("counts a file that is asked again as recent", async () => {
    const { store } = setup();
    await store.ensureFile("a.py");
    await store.ensureFile("b.py");
    await store.ensureFile("a.py");
    await store.ensureFile("c.py");
    expect([...store.getSources().keys()]).toEqual(["a.py", "c.py"]);
  });

  it("asks a dropped file again, and keeps the identity of the snapshots while nothing changes", async () => {
    const { store, fetchFile } = setup();
    await store.ensureFile("a.py");
    await store.ensureFile("b.py");
    await store.ensureFile("c.py");
    expect(fetchFile).toHaveBeenCalledTimes(3);
    const sources = store.getSources();
    const graph = store.getGraph();
    expect(store.getSources()).toBe(sources);
    expect(store.getGraph()).toBe(graph);
    store.keep(["a.py"]);
    expect(store.getSources()).toBe(sources);
    expect(await store.ensureFile("a.py")).toBe(true);
    expect(fetchFile).toHaveBeenCalledTimes(4);
    expect(store.getSources().has("a.py")).toBe(true);
    // Loading it again dropped the least recent one, not itself: no loop.
    expect([...store.getSources().keys()]).toEqual(["c.py", "a.py"]);
  });
});
