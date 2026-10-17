import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { fakeLang } from "./fake-lang";
import { TEST_TOKEN } from "./test-token";

// The screen names the build it shows by `version`: the explanation routes read that build,
// not the folder as the disk holds it now, and a request with no version reads the folder.
function setup() {
  const reads: { path: string; version: string | undefined }[] = [];
  const app = createApp({
    plugins: [
      fakeLang(() => ({
        language: "python",
        empty: true,
        nodes: [],
        edges: [],
      })),
    ],
    explain: async () => ({ status: "no-key" }),
    titles: async () => ({ status: "ok", titles: [] }),
    readProject: async (path, _include, version) => {
      reads.push({ path, version });
      return { kind: "not-found" };
    },
    port: 8148,
    token: TEST_TOKEN,
  });
  const post = (route: string, body: unknown) =>
    app.request(route, {
      method: "POST",
      headers: {
        host: "127.0.0.1:8148",
        "content-type": "application/json",
        "x-8n8-token": TEST_TOKEN,
      },
      body: JSON.stringify(body),
    });
  return { reads, post };
}

const ROUTES = [
  { route: "/api/summary", body: { root: "/loja", nodeId: "fn:f" } },
  { route: "/api/suggestions", body: { root: "/loja", nodeId: "fn:f" } },
  { route: "/api/titles", body: { root: "/loja", nodeIds: ["fn:f"] } },
];

describe("the build version of a folder", () => {
  it.each(ROUTES)(
    "$route reads the build the screen names",
    async ({ route, body }) => {
      const { reads, post } = setup();
      expect((await post(route, { ...body, version: "abc123" })).status).toBe(
        404,
      );
      expect(reads).toEqual([{ path: "/loja", version: "abc123" }]);
    },
  );

  it.each(ROUTES)(
    "$route reads the folder when the body has no version",
    async ({ route, body }) => {
      const { reads, post } = setup();
      await post(route, body);
      expect(reads).toEqual([{ path: "/loja", version: undefined }]);
    },
  );

  it("refuses a version that is not a short text", async () => {
    const { post } = setup();
    const res = await post("/api/summary", {
      root: "/loja",
      nodeId: "fn:f",
      version: "x".repeat(101),
    });
    expect(res.status).toBe(400);
  });
});
