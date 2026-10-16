import type { ProjectData } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { ProjectRead } from "../project-index";
import { fakeLang } from "./fake-lang";
import { TEST_TOKEN } from "./test-token";

const response: ProjectData = {
  name: "loja",
  graph: { language: "python", empty: false, nodes: [], edges: [] },
  files: [{ path: "a.py", source: "x = 1\n" }],
  ignored: [],
  version: "v1",
};
const built: ProjectRead = { kind: "ok", root: "/tmp/loja", response };

function setup(read: ProjectRead) {
  const calls: unknown[][] = [];
  const app = createApp({
    plugins: [fakeLang(() => response.graph)],
    explain: async () => ({ status: "no-key" }),
    titles: async () => ({ status: "ok", titles: [] }),
    readProject: async (...args) => {
      calls.push(args);
      return read;
    },
    port: 8148,
    token: TEST_TOKEN,
  });
  const post = (body: unknown) =>
    app.request("/api/project/file", {
      method: "POST",
      headers: {
        host: "127.0.0.1:8148",
        "content-type": "application/json",
        "x-8n8-token": TEST_TOKEN,
      },
      body: JSON.stringify(body),
    });
  return { calls, post };
}

describe("POST /api/project/file", () => {
  it("returns the source of one file and passes the version to readProject", async () => {
    const { calls, post } = setup(built);
    const res = await post({ root: "/tmp/loja", path: "a.py", version: "v1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "a.py", source: "x = 1\n" });
    expect(calls).toEqual([["/tmp/loja", undefined, "v1"]]);
  });

  it("answers 404 for a file the folder does not have and for a missing folder", async () => {
    const { post } = setup(built);
    const res = await post({ root: "/tmp/loja", path: "b.py" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not-found", path: "b.py" });
    const gone = await setup({ kind: "not-found" }).post({
      root: "/x",
      path: "a.py",
    });
    expect(gone.status).toBe(404);
  });

  it("answers 409 with the current version when the folder changed", async () => {
    const { post } = setup(built);
    const res = await post({ root: "/tmp/loja", path: "a.py", version: "v0" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "stale", version: "v1" });
  });

  it("answers 400 to a path outside the folder or a body without one", async () => {
    const { calls, post } = setup(built);
    for (const path of ["../a.py", "/a.py", "C:/a.py", "a\\b.py", ""]) {
      expect((await post({ root: "/tmp/loja", path })).status).toBe(400);
    }
    expect((await post({ root: "/tmp/loja" })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("answers 413 to a body over 1 MB", async () => {
    const { calls, post } = setup(built);
    const res = await post({ root: "x".repeat(1024 * 1024 + 1), path: "a.py" });
    expect(res.status).toBe(413);
    expect(calls).toEqual([]);
  });
});
