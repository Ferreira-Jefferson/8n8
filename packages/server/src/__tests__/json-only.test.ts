import { describe, expect, it } from "vitest";
import { createApp } from "../app";

function setup() {
  const calls = { explain: 0, readProject: 0 };
  const app = createApp({
    extractor: {
      language: "python",
      extract: () => ({
        language: "python",
        empty: true,
        nodes: [],
        edges: [],
      }),
    },
    explain: async () => {
      calls.explain++;
      return { status: "no-key" };
    },
    readProject: async () => {
      calls.readProject++;
      return { kind: "not-found" };
    },
    port: 4317,
  });
  const post = (
    path: string,
    headers: Record<string, string>,
    body = '{"source":"x","nodeId":"fn:f","path":"."}',
  ) =>
    app.request(path, {
      method: "POST",
      headers: { host: "127.0.0.1:4317", ...headers },
      body,
    });
  return { app, calls, post };
}

describe("API accepts only JSON (AD-016)", () => {
  it("refuses text/plain with 415 on every POST route and runs nothing", async () => {
    const { calls, post } = setup();
    for (const path of ["/api/graph", "/api/explain", "/api/project"]) {
      const res = await post(path, { "content-type": "text/plain" });
      expect(res.status).toBe(415);
    }
    expect(calls).toEqual({ explain: 0, readProject: 0 });
  });

  it("refuses a string body with no explicit content-type (fetch defaults it to text/plain) with 415", async () => {
    const { calls, post } = setup();
    for (const path of ["/api/graph", "/api/explain", "/api/project"]) {
      expect((await post(path, {})).status).toBe(415);
    }
    expect(calls).toEqual({ explain: 0, readProject: 0 });
  });

  it("refuses a post with no content-type header at all with 415", async () => {
    const { app, calls } = setup();
    for (const path of ["/api/graph", "/api/explain", "/api/project"]) {
      // A byte body gets no default content-type, so the header is really absent.
      const req = new Request(`http://127.0.0.1:4317${path}`, {
        method: "POST",
        headers: { host: "127.0.0.1:4317" },
        body: new TextEncoder().encode('{"path":"."}'),
      });
      expect(req.headers.get("content-type")).toBeNull();
      expect((await app.request(req)).status).toBe(415);
    }
    expect(calls).toEqual({ explain: 0, readProject: 0 });
  });

  it("refuses the other CORS-simple types (form-urlencoded, multipart) with 415 on every POST route", async () => {
    const { app, calls } = setup();
    const bodies = {
      "application/x-www-form-urlencoded": () =>
        new URLSearchParams({ path: "." }),
      "multipart/form-data": () => {
        const form = new FormData();
        form.append("path", ".");
        return form;
      },
    };
    for (const path of ["/api/graph", "/api/explain", "/api/project"]) {
      for (const [type, body] of Object.entries(bodies)) {
        const req = new Request(`http://127.0.0.1:4317${path}`, {
          method: "POST",
          headers: { host: "127.0.0.1:4317" },
          body: body(),
        });
        expect(req.headers.get("content-type")).toMatch(new RegExp(`^${type}`));
        expect((await app.request(req)).status).toBe(415);
      }
    }
    expect(calls).toEqual({ explain: 0, readProject: 0 });
  });

  it("accepts application/json with a charset parameter", async () => {
    const { post } = setup();
    const res = await post("/api/project", {
      "content-type": "application/json; charset=utf-8",
    });
    expect(res.status).toBe(404);
  });

  it("does not touch GET / with a valid Host", async () => {
    const { app } = setup();
    const res = await app.request("/", { headers: { host: "127.0.0.1:4317" } });
    expect(res.status).not.toBe(415);
  });
});
