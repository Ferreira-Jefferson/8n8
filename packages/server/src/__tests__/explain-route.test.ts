import { readFileSync } from "node:fs";
import { createPythonExtractor } from "@code2n8n/extract-python";
import type { ExplainRequest, ExplainResponse } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";

const videoFixture = readFileSync(
  new URL(
    "../../../extract-python/src/__tests__/fixtures/pedido_frete.py",
    import.meta.url,
  ),
  "utf8",
);

const extractor = await createPythonExtractor();

function setup(reply: ExplainResponse) {
  const received: ExplainRequest[] = [];
  const app = createApp({
    extractor,
    explain: async (req) => {
      received.push(req);
      return reply;
    },
    titles: async () => ({ status: "ok", titles: [] }),
    readProject: async () => ({ kind: "not-found" }),
    port: 4317,
  });
  const post = (body: unknown) =>
    app.request("/api/explain", {
      method: "POST",
      headers: { host: "127.0.0.1:4317", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { received, post };
}

const okReply: ExplainResponse = {
  status: "ok",
  explanation: {
    summary: "x",
    sentences: [],
    inputs: [],
    outputs: [],
    suggestions: [],
  },
  fromCache: false,
  review: "full",
};

describe("POST /api/explain", () => {
  it("masks the docstring and sends its text apart", async () => {
    const { received, post } = setup(okReply);
    const source = 'def f():\n    """Doc."""\n    return 1\n';
    await post({ source, nodeId: "fn:f" });
    expect(received[0]?.code).toBe(
      "def f():\n# docstring omitida\n    return 1",
    );
    expect(received[0]?.docstring).toEqual({
      text: '    """Doc."""',
      line: 2,
    });
  });

  it("builds the request from the server graph (CORE-17)", async () => {
    const { received, post } = setup(okReply);
    await post({ source: videoFixture, nodeId: "fn:calcular_frete" });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      nodeId: "fn:calcular_frete",
      nodeName: "calcular_frete",
      nodeKind: "function",
      code: videoFixture.split("\n").slice(3, 11).join("\n"),
      range: { start: 4, end: 11 },
      calls: [],
      calledBy: ["processar_pedido"],
    });
  });

  it("ignores extra fields sent by the web (CORE-17)", async () => {
    const { received, post } = setup(okReply);
    await post({
      source: videoFixture,
      nodeId: "fn:calcular_frete",
      code: "FORGED",
      calls: ["FORGED"],
      calledBy: ["FORGED"],
    });
    expect(JSON.stringify(received[0])).not.toContain("FORGED");
  });

  it("returns 200 with the same body for ok", async () => {
    const { post } = setup(okReply);
    const res = await post({
      source: videoFixture,
      nodeId: "fn:calcular_frete",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(okReply);
  });

  it("returns 200 { status: 'no-key' } for no-key (CORE-19)", async () => {
    const { post } = setup({ status: "no-key" });
    const res = await post({
      source: videoFixture,
      nodeId: "fn:calcular_frete",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "no-key" });
  });

  it("returns 200 with the same body for unfaithful (FID-10)", async () => {
    const { post } = setup({ status: "unfaithful" });
    const res = await post({
      source: videoFixture,
      nodeId: "fn:calcular_frete",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "unfaithful" });
  });

  it("returns 502 { status: 'error' } for error (CORE-20)", async () => {
    const { post } = setup({ status: "error", message: "boom" });
    const res = await post({
      source: videoFixture,
      nodeId: "fn:calcular_frete",
    });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { status: string }).status).toBe("error");
  });

  it("returns 404 for an unknown nodeId", async () => {
    const { received, post } = setup(okReply);
    const res = await post({ source: videoFixture, nodeId: "fn:nao_existe" });
    expect(res.status).toBe(404);
    expect(received).toEqual([]);
  });

  it("returns 200 for a step node (external, code) (VID-28)", async () => {
    const { received, post } = setup(okReply);
    const graph = extractor.extract(videoFixture);
    const steps = graph.nodes.filter(
      (n) => n.kind === "external" || n.kind === "code",
    );
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      const res = await post({ source: videoFixture, nodeId: step.id });
      expect(res.status).toBe(200);
    }
    expect(received.map((r) => r.nodeId)).toEqual(steps.map((s) => s.id));
  });

  it("builds the request of an external step from the server graph (VID-28)", async () => {
    const { received, post } = setup(okReply);
    const res = await post({
      source: videoFixture,
      nodeId: "fn:calcular_frete/s0",
    });
    expect(res.status).toBe(200);
    expect(received).toEqual([
      {
        nodeId: "fn:calcular_frete/s0",
        nodeName: "requests.get",
        nodeKind: "external",
        code: videoFixture.split("\n")[4],
        range: { start: 5, end: 5 },
        calls: [],
        calledBy: [],
      },
    ]);
  });

  it("sends a code step with kind code (VID-28)", async () => {
    const { received, post } = setup(okReply);
    await post({ source: videoFixture, nodeId: "fn:calcular_frete/s1" });
    expect(received[0]?.nodeKind).toBe("code");
    expect(received[0]?.code).toBe(
      videoFixture.split("\n").slice(5, 7).join("\n"),
    );
  });

  it("puts the target name of a call step in calls (VID-28)", async () => {
    const { received, post } = setup(okReply);
    const source = "def g():\n    return 1\n\ndef f():\n    g()\n";
    const graph = extractor.extract(source);
    const call = graph.nodes.find((n) => n.kind === "call");
    expect(call?.target).toBe("fn:g");
    await post({ source, nodeId: call?.id });
    expect(received[0]).toMatchObject({
      nodeKind: "call",
      nodeName: "g",
      calls: ["g"],
      calledBy: [],
    });
  });

  it("returns 400 node has no explanation for a folder and a file node (VID-28)", async () => {
    const files = [{ path: "pkg/a.py", source: "def f():\n    pass\n" }];
    const received: ExplainRequest[] = [];
    const app = createApp({
      extractor,
      explain: async (req) => {
        received.push(req);
        return okReply;
      },
      titles: async () => ({ status: "ok", titles: [] }),
      readProject: async (path) => ({
        kind: "ok",
        root: path,
        response: {
          name: "p",
          graph: extractor.extractProject(files),
          files,
          ignored: [],
        },
      }),
      port: 4317,
    });
    const graph = extractor.extractProject(files);
    const ids = graph.nodes
      .filter((n) => n.kind === "folder" || n.kind === "file")
      .map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(["dir:pkg", "file:pkg/a.py"]));
    for (const nodeId of ids) {
      const res = await app.request("/api/explain", {
        method: "POST",
        headers: {
          host: "127.0.0.1:4317",
          "content-type": "application/json",
        },
        body: JSON.stringify({ root: "/tmp/p", nodeId }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "node has no explanation" });
    }
    expect(received).toEqual([]);
  });

  it("returns 400 for an invalid body", async () => {
    const { post } = setup(okReply);
    expect((await post({ source: videoFixture })).status).toBe(400);
    expect((await post({ nodeId: "fn:calcular_frete" })).status).toBe(400);
    expect((await post({ source: 1, nodeId: 2 })).status).toBe(400);
  });
});
