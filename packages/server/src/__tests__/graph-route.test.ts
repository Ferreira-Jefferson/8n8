import { readFileSync } from "node:fs";
import { pythonPlugin } from "@8n8/lang-python";
import type { ExplainRequest, Graph } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { TEST_TOKEN } from "./test-token";

const videoFixture = readFileSync(
  new URL(
    "../../../languages/python/src/__tests__/fixtures/pedido_frete.py",
    import.meta.url,
  ),
  "utf8",
);

const explainCalls: ExplainRequest[] = [];
const app = createApp({
  plugins: [pythonPlugin],
  explain: async (req) => {
    explainCalls.push(req);
    return { status: "no-key" };
  },
  titles: async () => ({ status: "ok", titles: [] }),
  readProject: async () => ({ kind: "not-found" }),
  port: 4317,
  token: TEST_TOKEN,
});

const post = (body: unknown) =>
  app.request("/api/graph", {
    method: "POST",
    headers: {
      host: "127.0.0.1:4317",
      "x-8n8-token": TEST_TOKEN,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("POST /api/graph", () => {
  it("returns the graph of the video fixture (CORE-01)", async () => {
    const res = await post({ source: videoFixture });
    expect(res.status).toBe(200);
    const { graph } = (await res.json()) as { graph: Graph };
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain("fn:processar_pedido");
    expect(ids).toContain("fn:calcular_frete");
  });

  it("never calls explain (CORE-05)", async () => {
    await post({ source: videoFixture });
    expect(explainCalls).toEqual([]);
  });

  it("returns empty: true for an empty source (CORE-07)", async () => {
    const res = await post({ source: "" });
    expect(res.status).toBe(200);
    const { graph } = (await res.json()) as { graph: Graph };
    expect(graph.empty).toBe(true);
  });

  it("marks the node with syntaxError for a broken snippet (CORE-06)", async () => {
    const res = await post({ source: "def b(:\n    pass\n" });
    expect(res.status).toBe(200);
    const { graph } = (await res.json()) as { graph: Graph };
    expect(graph.nodes.some((n) => n.syntaxError !== undefined)).toBe(true);
  });

  it("answers 400 when source is missing or not text", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ source: 42 })).status).toBe(400);
  });
});
