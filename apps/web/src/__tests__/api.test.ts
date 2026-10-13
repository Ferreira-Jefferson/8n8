import type { Graph } from "@code2n8n/model";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchExplanation, fetchGraph } from "../api";

const graph: Graph = { language: "python", empty: false, nodes: [], edges: [] };

function fakeFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchGraph", () => {
  it("posts { source } to /api/graph and returns the graph", async () => {
    const fn = fakeFetch(200, { graph });
    const result = await fetchGraph("x = 1");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/graph");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ source: "x = 1" });
    expect(result).toEqual(graph);
  });

  it("rejects with an error on 400", async () => {
    fakeFetch(400, { error: "bad" });
    await expect(fetchGraph("x")).rejects.toThrow(Error);
  });
});

describe("fetchExplanation", () => {
  const ok = {
    status: "ok",
    explanation: { summary: "s", inputs: [], outputs: [], suggestions: [] },
    fromCache: false,
  };

  it("posts { source, nodeId } to /api/explain and returns ok as received", async () => {
    const fn = fakeFetch(200, ok);
    const result = await fetchExplanation("src", "f");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/explain");
    expect(JSON.parse(init.body as string)).toEqual({
      source: "src",
      nodeId: "f",
    });
    expect(result).toEqual(ok);
  });

  it("returns no-key as received", async () => {
    fakeFetch(200, { status: "no-key" });
    expect(await fetchExplanation("s", "f")).toEqual({ status: "no-key" });
  });

  it("maps 502 to status error (CORE-20)", async () => {
    fakeFetch(502, { status: "error", message: "boom" });
    expect(await fetchExplanation("s", "f")).toEqual({
      status: "error",
      message: "boom",
    });
  });

  it("maps a network failure to status error (CORE-20)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    const result = await fetchExplanation("s", "f");
    expect(result.status).toBe("error");
  });

  it("maps 404 to status stale", async () => {
    fakeFetch(404, { error: "not found" });
    expect(await fetchExplanation("s", "gone")).toEqual({ status: "stale" });
  });
});
