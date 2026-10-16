import type { Graph, ProjectResponse } from "@8n8/model";
import { describe, expect, it, vi } from "vitest";
import { createApp, type ProjectRead } from "../app";
import { type History, openHistory } from "../history";
import { fakeLang } from "./fake-lang";
import { TEST_TOKEN } from "./test-token";

const graph: Graph = {
  language: "python",
  empty: false,
  nodes: [],
  edges: [],
};
const empty: Graph = { ...graph, empty: true };
const response: ProjectResponse = {
  name: "loja",
  graph,
  files: [{ path: "a.py", source: "x = 1\n" }],
  ignored: [],
};

function setup(history: History, g: Graph = graph, read?: ProjectRead) {
  const app = createApp({
    plugins: [fakeLang(() => g)],
    explain: async () => ({ status: "no-key" }),
    titles: async () => ({ status: "ok", titles: [] }),
    readProject: async () => read ?? { kind: "ok", root: "/r/loja", response },
    port: 8148,
    token: TEST_TOKEN,
    history,
  });
  return (path: string, method = "GET", body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        host: "127.0.0.1:8148",
        "x-8n8-token": TEST_TOKEN,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

const saved = (h: History, n: number) =>
  vi.waitFor(() => expect(h.list()).toHaveLength(n));

describe("history routes", () => {
  it("saves a snippet after POST /api/graph and lists it", async () => {
    const h = openHistory(":memory:");
    const call = setup(h);
    expect((await call("/api/graph", "POST", { source: "a = 1" })).status).toBe(
      200,
    );
    await saved(h, 1);
    const { items } = (await (await call("/api/history")).json()) as {
      items: { title: string; kind: string }[];
    };
    expect(items).toMatchObject([{ title: "a = 1", kind: "snippet" }]);
  });

  it("saves a project after POST /api/project", async () => {
    const h = openHistory(":memory:");
    const call = setup(h);
    await call("/api/project", "POST", { path: "x" });
    await saved(h, 1);
    expect(h.list()[0]).toMatchObject({ kind: "project", root: "/r/loja" });
  });

  it("saves nothing for an empty graph or a missing folder", async () => {
    const h = openHistory(":memory:");
    await setup(h, empty)("/api/graph", "POST", { source: "" });
    await setup(h, graph, { kind: "not-found" })("/api/project", "POST", {
      path: "x",
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(h.list()).toEqual([]);
  });

  it("GET /api/history/:id returns the text and language, and counts no visit (the re-read does)", async () => {
    const h = openHistory(":memory:");
    const call = setup(h);
    await call("/api/graph", "POST", { source: "a = 1" });
    await saved(h, 1);
    const id = h.list()[0]?.id;
    const res = await call(`/api/history/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entry: { kind: "snippet", source: "a = 1", language: "python" },
    });
    expect(h.list()[0]?.openCount).toBe(1);
  });

  it("answers 404 for a missing id and 400 for a bad one", async () => {
    const call = setup(openHistory(":memory:"));
    expect((await call("/api/history/42")).status).toBe(404);
    expect((await call("/api/history/abc")).status).toBe(400);
    expect((await call("/api/history/1.5", "DELETE")).status).toBe(400);
    expect((await call("/api/history/42", "DELETE")).status).toBe(404);
  });

  it("DELETE /api/history/:id answers 204 and removes it", async () => {
    const h = openHistory(":memory:");
    const call = setup(h);
    await call("/api/graph", "POST", { source: "a = 1" });
    await saved(h, 1);
    const res = await call(`/api/history/${h.list()[0]?.id}`, "DELETE");
    expect(res.status).toBe(204);
    expect(h.list()).toEqual([]);
  });

  it("PUT /api/history/:id/star marks the row; bad ids, bodies and unknown ids are refused", async () => {
    const h = openHistory(":memory:");
    const call = setup(h);
    await call("/api/graph", "POST", { source: "a = 1" });
    await saved(h, 1);
    const id = h.list()[0]?.id;
    const star = (path: string, body: unknown) => call(path, "PUT", body);
    expect(
      (await star(`/api/history/${id}/star`, { starred: true })).status,
    ).toBe(204);
    expect(h.list()[0]?.starred).toBe(true);
    const { items } = (await (await call("/api/history")).json()) as {
      items: { starred: boolean }[];
    };
    expect(items[0]?.starred).toBe(true);
    expect(
      (await star("/api/history/abc/star", { starred: true })).status,
    ).toBe(400);
    expect(
      (await star(`/api/history/${id}/star`, { starred: "sim" })).status,
    ).toBe(400);
    expect((await star("/api/history/42/star", { starred: true })).status).toBe(
      404,
    );
  });

  it("a throwing history never breaks POST /api/graph", async () => {
    const boom = () => {
      throw new Error("disk full");
    };
    const h = { ...openHistory(":memory:"), save: boom };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await setup(h)("/api/graph", "POST", { source: "a = 1" });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(log).toHaveBeenCalled());
    log.mockRestore();
  });
});
