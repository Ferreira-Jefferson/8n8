import { readFileSync } from "node:fs";
import { pythonPlugin } from "@8n8/lang-python";
import type { SourceFile, TitleRequest, TitlesResponse } from "@8n8/model";
import { buildProject } from "@8n8/project";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";

const fixture = readFileSync(
  new URL(
    "../../../languages/python/src/__tests__/fixtures/pedido_frete.py",
    import.meta.url,
  ),
  "utf8",
);
const lines = fixture.split("\n");

const WIN_ROOT = String.raw`C:\tmp\loja`;
const FILES: SourceFile[] = [
  {
    path: "pkg/a.py",
    source: "def g():\n    return 1\n\ndef f():\n    return g()\n",
  },
];

function setup(reply: TitlesResponse = { status: "ok", titles: [] }) {
  const received: TitleRequest[] = [];
  const app = createApp({
    plugins: [pythonPlugin],
    explain: async () => ({ status: "no-key" }),
    titles: async (req) => {
      received.push(req);
      return reply;
    },
    readProject: async (path) =>
      path === WIN_ROOT
        ? {
            kind: "ok",
            root: WIN_ROOT,
            response: {
              name: "loja",
              graph: buildProject(FILES, [pythonPlugin]),
              files: FILES,
              ignored: [],
            },
          }
        : { kind: "not-found" },
    port: 4317,
  });
  const post = (
    body: unknown,
    { host = "127.0.0.1:4317", type = "application/json" } = {},
  ) =>
    app.request("/api/titles", {
      method: "POST",
      headers: { host, "content-type": type },
      body: JSON.stringify(body),
    });
  return { received, post };
}

const okReply: TitlesResponse = {
  status: "ok",
  titles: [
    {
      nodeId: "fn:calcular_frete",
      text: "Calcular frete",
      lines: [4],
      fromCache: false,
    },
  ],
};

describe("POST /api/titles (VID-14)", () => {
  it("builds one item per node of a snippet and answers with deps.titles", async () => {
    const { received, post } = setup(okReply);
    const res = await post({
      source: fixture,
      nodeIds: ["fn:calcular_frete", "fn:calcular_frete/s0"],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(okReply);
    expect(received).toEqual([
      {
        items: [
          {
            nodeId: "fn:calcular_frete",
            cacheKey: "python|fn:calcular_frete",
            language: "python",
            kind: "function",
            name: "calcular_frete",
            code: lines.slice(3, 11).join("\n"),
            range: { start: 4, end: 11 },
            calls: [],
            calledBy: ["processar_pedido"],
          },
          {
            nodeId: "fn:calcular_frete/s0",
            cacheKey: "python|fn:calcular_frete/s0",
            language: "python",
            kind: "external",
            name: "requests.get",
            code: lines[4],
            range: { start: 5, end: 5 },
            calls: [],
            calledBy: [],
          },
        ],
      },
    ]);
  });

  it("keys a project item by the POSIX root and drops folder and file nodes (VID-17)", async () => {
    const { received, post } = setup();
    const res = await post({
      root: WIN_ROOT,
      nodeIds: ["dir:pkg", "file:pkg/a.py", "file:pkg/a.py/fn:f"],
    });
    expect(res.status).toBe(200);
    expect(received).toEqual([
      {
        items: [
          {
            nodeId: "file:pkg/a.py/fn:f",
            cacheKey: "C:/tmp/loja|file:pkg/a.py/fn:f",
            language: "python",
            kind: "function",
            name: "f",
            code: "def f():\n    return g()",
            range: { start: 4, end: 5 },
            calls: ["g"],
            calledBy: [],
          },
        ],
      },
    ]);
  });

  it("drops unknown and repeated ids and keeps the order received", async () => {
    const { received, post } = setup();
    await post({
      source: fixture,
      nodeIds: [
        "fn:calcular_frete/s1",
        "fn:nao_existe",
        "fn:calcular_frete",
        "fn:calcular_frete/s1",
      ],
    });
    expect(received[0]?.items.map((i) => i.nodeId)).toEqual([
      "fn:calcular_frete/s1",
      "fn:calcular_frete",
    ]);
  });

  it("answers ok with no titles and does not call deps.titles when no item is left", async () => {
    const { received, post } = setup(okReply);
    for (const body of [
      { source: fixture, nodeIds: [] },
      { source: fixture, nodeIds: ["fn:nao_existe"] },
      { root: WIN_ROOT, nodeIds: ["dir:pkg", "file:pkg/a.py"] },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok", titles: [] });
    }
    expect(received).toEqual([]);
  });

  it.each<TitlesResponse>([
    { status: "no-key", titles: [] },
    { status: "error", message: "rede caiu", titles: okReply.titles },
  ])("answers 200 with the body of deps.titles for $status", async (reply) => {
    const { post } = setup(reply);
    const res = await post({ source: fixture, nodeIds: ["fn:calcular_frete"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(reply);
  });

  it("answers 400 to an invalid body", async () => {
    const { received, post } = setup();
    for (const body of [
      {},
      { source: fixture },
      { nodeIds: ["fn:calcular_frete"] },
      { source: 1, nodeIds: ["fn:calcular_frete"] },
      { source: fixture, nodeIds: "fn:calcular_frete" },
      { source: fixture, nodeIds: [1] },
      { root: "", nodeIds: [] },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid body" });
    }
    expect(received).toEqual([]);
  });

  it("accepts 200 ids and answers 400 to 201", async () => {
    const { received, post } = setup();
    const ids = (n: number) => [
      "fn:calcular_frete",
      ...Array.from({ length: n - 1 }, (_, i) => `fn:x${i}`),
    ];
    expect((await post({ source: fixture, nodeIds: ids(200) })).status).toBe(
      200,
    );
    expect(received).toHaveLength(1);
    expect((await post({ source: fixture, nodeIds: ids(201) })).status).toBe(
      400,
    );
    expect(received).toHaveLength(1);
  });

  it("answers 404 when the folder is gone", async () => {
    const { received, post } = setup();
    const res = await post({ root: String.raw`C:\outra`, nodeIds: ["x"] });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "not-found",
      path: String.raw`C:\outra`,
    });
    expect(received).toEqual([]);
  });

  it("answers 415 to a body that is not JSON (AD-016)", async () => {
    const { received, post } = setup();
    const res = await post(
      { source: fixture, nodeIds: ["fn:calcular_frete"] },
      { type: "text/plain" },
    );
    expect(res.status).toBe(415);
    expect(received).toEqual([]);
  });

  it("answers 403 to a foreign Host (AD-007)", async () => {
    const { received, post } = setup();
    const res = await post(
      { source: fixture, nodeIds: ["fn:calcular_frete"] },
      { host: "evil.example:4317" },
    );
    expect(res.status).toBe(403);
    expect(received).toEqual([]);
  });
});
