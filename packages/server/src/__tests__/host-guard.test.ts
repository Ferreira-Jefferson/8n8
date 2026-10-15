import type { Graph } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { fakeLang } from "./fake-lang";
import { TEST_TOKEN } from "./test-token";

const emptyGraph: Graph = {
  language: "python",
  empty: true,
  nodes: [],
  edges: [],
};

const app = createApp({
  plugins: [fakeLang(() => emptyGraph)],
  explain: async () => ({ status: "no-key" }),
  titles: async () => ({ status: "ok", titles: [] }),
  readProject: async () => ({ kind: "not-found" }),
  port: 4317,
  token: TEST_TOKEN,
});

const get = (host: string) => app.request("/", { headers: { host } });

describe("Host guard (AD-007)", () => {
  it("refuses a foreign host with 403", async () => {
    expect((await get("evil.example:4317")).status).toBe(403);
  });

  it("lets 127.0.0.1:4317 and localhost:4317 through", async () => {
    expect((await get("127.0.0.1:4317")).status).not.toBe(403);
    expect((await get("localhost:4317")).status).not.toBe(403);
  });

  it("refuses localhost on another port with 403", async () => {
    expect((await get("localhost:9999")).status).toBe(403);
  });

  it("sends no Access-Control-Allow-Origin header", async () => {
    for (const host of ["evil.example:4317", "localhost:4317"]) {
      const res = await app.request("/", {
        headers: { host, origin: "http://evil.example" },
      });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
  });
});
