import type { ProjectResponse } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { createApp, type ProjectRead } from "../app";

const response: ProjectResponse = {
  name: "loja",
  graph: { language: "python", empty: false, nodes: [], edges: [] },
  files: [{ path: "a.py", source: "x = 1\n" }],
  ignored: [{ path: "grande.py", reason: "too-large" }],
};

function setup(read: ProjectRead) {
  const paths: string[] = [];
  const app = createApp({
    extractor: {
      language: "python",
      extract: () => response.graph,
    },
    explain: async () => ({ status: "no-key" }),
    readProject: async (path) => {
      paths.push(path);
      return read;
    },
    port: 4317,
  });
  const post = (body: unknown, host = "127.0.0.1:4317") =>
    app.request("/api/project", {
      method: "POST",
      headers: { host, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { paths, post };
}

describe("POST /api/project", () => {
  it("returns { name, graph, files, ignored } from readProject, called with the typed path (PROJ-06)", async () => {
    const { paths, post } = setup({ kind: "ok", root: "/tmp/loja", response });
    const res = await post({ path: "./minha pasta/loja" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(response);
    expect(paths).toEqual(["./minha pasta/loja"]);
  });

  it("not-found becomes 404 { error, path } with the path as typed (PROJ-05)", async () => {
    const { post } = setup({ kind: "not-found" });
    const res = await post({ path: "./nao/existe" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "not-found",
      path: "./nao/existe",
    });
  });

  it("answers 400 to {}, an empty path and a non-string path", async () => {
    const { paths, post } = setup({ kind: "not-found" });
    for (const body of [{}, { path: "" }, { path: 42 }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid body" });
    }
    expect(paths).toEqual([]);
  });

  it("refuses a foreign Host with 403 and does not run readProject (PROJ-08)", async () => {
    const { paths, post } = setup({ kind: "ok", root: "/x", response });
    const res = await post({ path: "." }, "evil.example:4317");
    expect(res.status).toBe(403);
    expect(paths).toEqual([]);
  });
});
