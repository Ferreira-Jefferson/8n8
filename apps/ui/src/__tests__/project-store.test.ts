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
