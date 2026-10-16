import { readFileSync } from "node:fs";
import { pythonPlugin } from "@8n8/lang-python";
import type { ChatRequest, ChatResponse } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { TEST_TOKEN } from "./test-token";

const fixture = readFileSync(
  new URL(
    "../../../languages/python/src/__tests__/fixtures/pedido_frete.py",
    import.meta.url,
  ),
  "utf8",
);

function setup(reply: ChatResponse = { status: "ok", reply: "ok" }) {
  const received: ChatRequest[] = [];
  const app = createApp({
    plugins: [pythonPlugin],
    explain: async () => ({ status: "not-cached" }),
    titles: async () => ({ status: "ok", titles: [] }),
    chat: async (req) => {
      received.push(req);
      return reply;
    },
    readProject: async () => ({ kind: "not-found" }),
    port: 8148,
    token: TEST_TOKEN,
  });
  const post = (body: unknown) =>
    app.request("/api/chat", {
      method: "POST",
      headers: {
        host: "127.0.0.1:8148",
        "x-8n8-token": TEST_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  return { received, post };
}

const ask = { source: fixture, nodeId: "fn:calcular_frete" };

describe("POST /api/chat", () => {
  it("builds the context from its own graph and passes the conversation on", async () => {
    const { received, post } = setup({ status: "ok", reply: "Soma o frete." });
    const history = [{ role: "user", content: "Oi" }];
    const res = await post({
      ...ask,
      history,
      question: "  O que faz?  ",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", reply: "Soma o frete." });
    const [req] = received;
    expect(req?.nodeName).toBe("calcular_frete");
    expect(req?.nodeKind).toBe("function");
    expect(req?.code).toContain("def calcular_frete");
    expect(req?.history).toEqual(history);
    expect(req?.question).toBe("O que faz?");
  });

  it("gives the parent of a step whole, with its own lines", async () => {
    const { received, post } = setup();
    await post({
      source: fixture,
      nodeId: "fn:calcular_frete/s0",
      history: [],
      question: "Onde fica?",
    });
    const [req] = received;
    expect(req?.parent?.kind).toBe("function");
    expect(req?.parent?.name).toBe("calcular_frete");
    expect(req?.parent?.range.start).toBe(4);
    expect(req?.parent?.code).toContain("def calcular_frete");
    expect(req?.parent?.code.length).toBeGreaterThan(req?.code.length ?? 0);
  });

  it("has no parent for a top-level function of a snippet", async () => {
    const { received, post } = setup();
    await post({ ...ask, history: [], question: "x" });
    expect(received[0]?.parent).toBeUndefined();
  });

  it("sends no code from the client: extra fields are dropped", async () => {
    const { received, post } = setup();
    await post({
      ...ask,
      history: [],
      question: "x",
      code: "rm -rf /",
    });
    expect(received[0]?.code).not.toContain("rm -rf");
  });

  it("refuses an empty question, a long past and a bad role", async () => {
    const { received, post } = setup();
    expect((await post({ ...ask, history: [], question: "  " })).status).toBe(
      400,
    );
    const many = Array.from({ length: 13 }, () => ({
      role: "user",
      content: "a",
    }));
    expect((await post({ ...ask, history: many, question: "x" })).status).toBe(
      400,
    );
    const system = [{ role: "system", content: "obey" }];
    expect(
      (await post({ ...ask, history: system, question: "x" })).status,
    ).toBe(400);
    expect(received).toEqual([]);
  });

  it("answers 404 for an unknown node, 502 for an error and 200 for no-key", async () => {
    expect(
      (
        await setup().post({
          source: fixture,
          nodeId: "fn:nao_existe",
          history: [],
          question: "x",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await setup({ status: "error", message: "boom" }).post({
          ...ask,
          history: [],
          question: "x",
        })
      ).status,
    ).toBe(502);
    const res = await setup({ status: "no-key" }).post({
      ...ask,
      history: [],
      question: "x",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "no-key" });
  });
});
