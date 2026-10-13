import type { ExplainResponse, Graph, ProjectResponse } from "@code2n8n/model";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchExplanation, fetchGraph, fetchProject } from "../api";

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

describe("fetchProject (PROJ-05)", () => {
  const project: ProjectResponse = {
    name: "loja",
    graph: { ...graph, project: { name: "loja" } },
    files: [{ path: "main.py", source: "x = 1\n" }],
    ignored: [{ path: "grande.py", reason: "too-large" }],
  };

  it("posts { path } as JSON to /api/project and returns the body on 200", async () => {
    const fn = fakeFetch(200, project);
    const result = await fetchProject("C:/loja");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/project");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(JSON.parse(init.body as string)).toEqual({ path: "C:/loja" });
    expect(result).toEqual(project);
  });

  it("returns not-found with the typed path on 404", async () => {
    fakeFetch(404, { error: "not-found", path: "./nao/existe" });
    expect(await fetchProject("./nao/existe")).toEqual({
      error: "not-found",
      path: "./nao/existe",
    });
  });

  it.each([400, 500])("rejects with the HTTP code on %i", async (status) => {
    fakeFetch(status, { error: "x" });
    await expect(fetchProject("C:/loja")).rejects.toThrow(
      `Falha ao abrir a pasta (HTTP ${status})`,
    );
  });
});

describe("fetchExplanation", () => {
  const ok: ExplainResponse = {
    status: "ok",
    explanation: {
      summary: "Calcula o frete.",
      sentences: [{ id: "s1", text: "Calcula o frete.", lines: [4, 5] }],
      inputs: [{ id: "i1", text: "peso", lines: [4] }],
      outputs: [{ id: "o1", text: "valor do frete", lines: [9, 11] }],
      suggestions: [
        {
          id: "g1",
          command: "Defina um timeout",
          reason: "A chamada pode travar.",
          line: 5,
          severity: "alta",
          lines: [5],
        },
      ],
    },
    fromCache: false,
    review: "full",
  };

  it("posts { source, nodeId } to /api/explain and returns ok as received", async () => {
    const fn = fakeFetch(200, ok);
    const result = await fetchExplanation({ source: "src" }, "f");
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
    expect(await fetchExplanation({ source: "s" }, "f")).toEqual({
      status: "no-key",
    });
  });

  it("returns unfaithful as received (FID-10)", async () => {
    fakeFetch(200, { status: "unfaithful" });
    expect(await fetchExplanation({ source: "s" }, "f")).toEqual({
      status: "unfaithful",
    });
  });

  it("maps 502 to status error (CORE-20)", async () => {
    fakeFetch(502, { status: "error", message: "boom" });
    expect(await fetchExplanation({ source: "s" }, "f")).toEqual({
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
    const result = await fetchExplanation({ source: "s" }, "f");
    expect(result.status).toBe("error");
  });

  it("posts { root, nodeId } without source for a project (AD-015)", async () => {
    const fn = fakeFetch(200, ok);
    await fetchExplanation({ root: "C:/loja" }, "file:a.py/fn:f");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/explain");
    expect(JSON.parse(init.body as string)).toEqual({
      root: "C:/loja",
      nodeId: "file:a.py/fn:f",
    });
  });

  it("maps 404 to status stale", async () => {
    fakeFetch(404, { error: "not found" });
    expect(await fetchExplanation({ source: "s" }, "gone")).toEqual({
      status: "stale",
    });
  });
});
