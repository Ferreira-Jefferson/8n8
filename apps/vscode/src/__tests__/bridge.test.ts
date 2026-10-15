import { createCore } from "@8n8/server";
import { describe, expect, it } from "vitest";
import {
  BRIDGE_HOST,
  BRIDGE_PORT,
  type CoreApp,
  createBridge,
} from "../bridge";

const TOKEN = "vscode-bridge-token-not-a-secret-0000";

/** An app that records every request that reaches it. */
function recording(status = 200, body = '{"ok":true}') {
  const seen: Request[] = [];
  const app: CoreApp = {
    fetch: (req) => {
      seen.push(req);
      return new Response(body, {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  };
  return { app, seen };
}

const valid = {
  type: "api",
  id: 7,
  method: "POST",
  path: "/api/project",
  body: '{"path":"C:/loja"}',
};

describe("createBridge: what passes (VSC-11)", () => {
  it("passes a valid message with the guard's Host, the token and JSON", async () => {
    const { app, seen } = recording();
    const reply = await createBridge(app, TOKEN).handle(valid);
    expect(reply).toEqual({
      type: "api-response",
      id: 7,
      status: 200,
      body: '{"ok":true}',
      contentType: "application/json",
    });
    const [req] = seen;
    expect(req?.url).toBe(`http://${BRIDGE_HOST}/api/project`);
    expect(req?.method).toBe("POST");
    expect(req?.headers.get("host")).toBe(BRIDGE_HOST);
    expect(req?.headers.get("x-8n8-token")).toBe(TOKEN);
    expect(req?.headers.get("content-type")).toBe("application/json");
    expect(await req?.text()).toBe('{"path":"C:/loja"}');
  });

  it("passes a GET without a body and keeps the answer's status", async () => {
    const { app, seen } = recording(404, '{"error":"not-found"}');
    const reply = await createBridge(app, TOKEN).handle({
      type: "api",
      id: 1,
      method: "GET",
      path: "/api/history/12",
    });
    expect(reply.status).toBe(404);
    expect(seen[0]?.headers.get("content-type")).toBeNull();
  });

  it("works with the real core: the guards accept the bridge and refuse a wrong token", async () => {
    const app = createCore({
      env: {},
      ptsRules: "regras",
      cacheDir: "unused",
      historyFile: undefined,
      port: BRIDGE_PORT,
      token: TOKEN,
      settings: { read: async () => ({}), write: async () => {} },
    });
    const ok = await createBridge(app, TOKEN).handle({
      type: "api",
      id: 1,
      method: "GET",
      path: "/api/languages",
    });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).languages).toHaveLength(2);
    const refused = await createBridge(
      app,
      "outro-token-000000000000000000000000",
    ).handle({
      type: "api",
      id: 2,
      method: "GET",
      path: "/api/languages",
    });
    expect(refused.status).toBe(401);
  });
});

describe("createBridge: what never reaches the core (VSC-10)", () => {
  it.each([
    ["not an object", "texto"],
    ["null", null],
    ["another type", { ...valid, type: "ready" }],
    ["a non-integer id", { ...valid, id: 1.5 }],
    ["an unknown method", { ...valid, method: "PATCH" }],
    ["a lowercase method", { ...valid, method: "post" }],
    ["a path outside /api", { ...valid, path: "/index.html" }],
    ["a full url", { ...valid, path: "http://evil.example/api/x" }],
    ["a scheme", { ...valid, path: "file:///api/x" }],
    ["a dot-dot path", { ...valid, path: "/api/../secret" }],
    ["a double slash", { ...valid, path: "/api//project" }],
    ["a backslash", { ...valid, path: "/api/\\project" }],
    ["a query", { ...valid, path: "/api/project?x=1" }],
    ["a body that is not text", { ...valid, body: { path: "C:/" } }],
    ["a body over 1 MB", { ...valid, body: "x".repeat(1024 * 1024 + 1) }],
    ["an extra field", { ...valid, headers: { host: "evil" } }],
    ["a token from the page", { ...valid, token: "x" }],
  ])("answers 400 to %s", async (_, message) => {
    const { app, seen } = recording();
    const reply = await createBridge(app, TOKEN).handle(message);
    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.body)).toEqual({ error: "invalid message" });
    expect(seen).toEqual([]);
  });

  it("keeps the id of an invalid message when it is an integer", async () => {
    const { app } = recording();
    expect(
      (await createBridge(app, TOKEN).handle({ ...valid, method: "PATCH" })).id,
    ).toBe(7);
  });
});
