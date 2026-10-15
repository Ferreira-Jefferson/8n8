import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Graph } from "@8n8/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createCore } from "../core";
import type { History } from "../history";
import { fakeLang } from "./fake-lang";
import { TEST_TOKEN } from "./test-token";

const HOST = "127.0.0.1:4317";
const emptyGraph: Graph = {
  language: "python",
  empty: true,
  nodes: [],
  edges: [],
};

/** Counts every call that would read a folder, touch the history or spend the LLM. */
let work = 0;
const countingHistory = new Proxy({} as History, {
  get: () => () => {
    work++;
    return [];
  },
});
const app = createApp({
  plugins: [fakeLang(() => emptyGraph)],
  explain: async () => {
    work++;
    return { status: "no-key" };
  },
  titles: async () => {
    work++;
    return { status: "ok", titles: [] };
  },
  readProject: async () => {
    work++;
    return { kind: "not-found" };
  },
  port: 4317,
  token: TEST_TOKEN,
  history: countingHistory,
});

/** Every /api route the app registers, read from the app itself: a new route is attacked with no edit here. */
const apiRoutes = app.routes
  .filter((r) => r.method !== "ALL" && r.path.startsWith("/api/"))
  .map((r) => ({ method: r.method, path: r.path.replace(/:\w+/g, "1") }));

const send = (
  route: { method: string; path: string },
  headers: Record<string, string>,
) =>
  app.request(route.path, {
    method: route.method,
    headers,
    ...(route.method === "GET" || route.method === "DELETE"
      ? {}
      : { body: '{"source":"x","path":"C:/p","starred":true}' }),
  });

const JSON_TYPE = { "content-type": "application/json" };

describe("every /api route under attack (DIST-21)", () => {
  it("finds the routes in the app, not in a list written here", () => {
    const keys = apiRoutes.map((r) => `${r.method} ${r.path}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        "POST /api/graph",
        "GET /api/languages",
        "POST /api/project",
        "GET /api/history",
        "GET /api/history/1",
        "PUT /api/history/1/star",
        "DELETE /api/history/1",
        "POST /api/explain",
        "POST /api/titles",
      ]),
    );
  });

  describe.each(apiRoutes)("$method $path", (route) => {
    it("answers 403 to a foreign Host, before any work", async () => {
      work = 0;
      const res = await send(route, {
        host: "evil.example:4317",
        "x-8n8-token": TEST_TOKEN,
        ...JSON_TYPE,
      });
      expect(res.status).toBe(403);
      expect(work).toBe(0);
    });

    it("answers 401 without the token, before any work", async () => {
      work = 0;
      const res = await send(route, { host: HOST, ...JSON_TYPE });
      expect(res.status).toBe(401);
      expect(work).toBe(0);
    });

    it("answers 401 to a wrong token, before any work", async () => {
      work = 0;
      const res = await send(route, {
        host: HOST,
        "x-8n8-token": `${TEST_TOKEN.slice(0, -1)}x`,
        ...JSON_TYPE,
      });
      expect(res.status).toBe(401);
      expect(work).toBe(0);
    });

    if (route.method === "POST") {
      it("answers 415 to a body that is not JSON, before any work", async () => {
        work = 0;
        const res = await send(route, {
          host: HOST,
          "x-8n8-token": TEST_TOKEN,
          "content-type": "text/plain",
        });
        expect(res.status).toBe(415);
        expect(work).toBe(0);
      });
    }
  });
});

describe("the API key never reaches a response (DIST-22)", () => {
  const SENTINEL = "sk-sentinel-0000000000000000000000000000";
  const dir = mkdtempSync(join(tmpdir(), "8n8-sentinel-"));
  const project = join(dir, "proj");
  let provider: Server;
  let core: ReturnType<typeof createCore>;

  beforeAll(async () => {
    mkdirSync(project);
    writeFileSync(join(project, "a.py"), "def f(x):\n    return g(x)\n");
    // A hostile provider: its error message echoes the key it received, whole and
    // masked the way OpenAI masks it in a real 401.
    provider = createServer((req, res) => {
      const key = String(req.headers.authorization).replace("Bearer ", "");
      const masked = `${key.slice(0, 8)}****${key.slice(-4)}`;
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: `Incorrect API key: ${key} (${masked})` },
        }),
      );
    });
    await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
    const { port } = provider.address() as AddressInfo;
    core = createCore({
      env: {
        OPENROUTER_API_KEY: SENTINEL,
        OPENROUTER_BASE_URL: `http://127.0.0.1:${port}/v1`,
      },
      ptsRules: "regras",
      cacheDir: join(dir, "cache"),
      historyFile: ":memory:",
      port: 4317,
      token: TEST_TOKEN,
    });
  });
  afterAll(() => {
    provider.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await core.request(path, {
      method,
      headers: { host: HOST, "x-8n8-token": TEST_TOKEN, ...JSON_TYPE },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { text: await res.text(), headers: [...res.headers].join("\n") };
  };

  it("leaves the key out of every body and header, even when the provider echoes it", async () => {
    const answers = [
      await call("POST", "/api/graph", {
        source: "def f(x):\n    return g(x)\n",
      }),
      await call("GET", "/api/languages"),
      await call("POST", "/api/project", { path: project }),
      await call("POST", "/api/explain", {
        root: project,
        nodeId: "file:a.py/fn:f",
      }),
      await call("POST", "/api/titles", {
        root: project,
        nodeIds: ["file:a.py/fn:f"],
      }),
      await call("GET", "/api/history"),
      await call("GET", "/api/history/1"),
      await call("PUT", "/api/history/1/star", { starred: true }),
      await call("DELETE", "/api/history/1"),
    ];
    // The hostile provider was reached: the explain answer is an error.
    expect(answers[3]?.text).toContain('"status":"error"');
    for (const { text, headers } of answers) {
      expect(text).not.toContain(SENTINEL);
      expect(headers).not.toContain(SENTINEL);
      // Not even the masked form: no word of the answer starts like the key.
      expect(text).not.toContain(SENTINEL.slice(0, 6));
    }
  });
});
