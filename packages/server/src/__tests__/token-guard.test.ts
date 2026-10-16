import type { Graph } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { sameToken } from "../token";
import { fakeLang } from "./fake-lang";
import { TEST_TOKEN } from "./test-token";

const emptyGraph: Graph = {
  language: "python",
  empty: true,
  nodes: [],
  edges: [],
};

let reads = 0;
const app = createApp({
  plugins: [fakeLang(() => emptyGraph)],
  explain: async () => ({ status: "no-key" }),
  titles: async () => ({ status: "ok", titles: [] }),
  readProject: async () => {
    reads++;
    return { kind: "not-found" };
  },
  port: 8148,
  token: TEST_TOKEN,
});

const postProject = (token?: string) =>
  app.request("/api/project", {
    method: "POST",
    headers: {
      host: "127.0.0.1:8148",
      "content-type": "application/json",
      ...(token === undefined ? {} : { "x-8n8-token": token }),
    },
    body: JSON.stringify({ path: "C:/p" }),
  });

describe("token guard (DIST-20)", () => {
  it("answers 401 without the token and reads no folder", async () => {
    reads = 0;
    expect((await postProject()).status).toBe(401);
    expect(reads).toBe(0);
  });

  it("answers 401 with a wrong token and reads no folder", async () => {
    reads = 0;
    expect((await postProject(`${TEST_TOKEN}x`)).status).toBe(401);
    expect((await postProject("")).status).toBe(401);
    expect(reads).toBe(0);
  });

  it("lets the right token through to the route", async () => {
    reads = 0;
    expect((await postProject(TEST_TOKEN)).status).toBe(404);
    expect(reads).toBe(1);
  });

  it("asks no token for the page itself", async () => {
    const res = await app.request("/", { headers: { host: "127.0.0.1:8148" } });
    expect(res.status).not.toBe(401);
  });

  it("checks the Host before the token: a foreign host gets 403", async () => {
    const res = await app.request("/api/languages", {
      headers: { host: "evil.example:8148" },
    });
    expect(res.status).toBe(403);
  });
});

describe("sameToken", () => {
  it("accepts only the same token", () => {
    expect(sameToken("a".repeat(64), "a".repeat(64))).toBe(true);
    expect(sameToken("a".repeat(64), "b".repeat(64))).toBe(false);
  });

  it("refuses a missing token and one of another length", () => {
    expect(sameToken("a".repeat(64), undefined)).toBe(false);
    expect(sameToken("a".repeat(64), "a".repeat(63))).toBe(false);
  });
});
