import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { fakeLang } from "./fake-lang";
import { TEST_TOKEN } from "./test-token";

// Files over 1 MB the person put on the map travel with every request of the
// same folder, so the server reads the folder the screen shows (CLEAN-06, CLEAN-07).
function setup() {
  const reads: { path: string; include: string[] | undefined }[] = [];
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
    readProject: async (path, include) => {
      reads.push({ path, include });
      return { kind: "not-found" };
    },
    port: 4317,
    token: TEST_TOKEN,
  });
  const post = (route: string, body: unknown) =>
    app.request(route, {
      method: "POST",
      headers: {
        host: "127.0.0.1:4317",
        "content-type": "application/json",
        "x-8n8-token": TEST_TOKEN,
      },
      body: JSON.stringify(body),
    });
  return { reads, post };
}

const ROUTES = [
  { route: "/api/project", body: { path: "/loja" } },
  { route: "/api/summary", body: { root: "/loja", nodeId: "fn:f" } },
  { route: "/api/suggestions", body: { root: "/loja", nodeId: "fn:f" } },
  { route: "/api/titles", body: { root: "/loja", nodeIds: ["fn:f"] } },
];

describe("the included files of a folder (CLEAN-06, CLEAN-07)", () => {
  it.each(ROUTES)(
    "$route reads the folder with the included files",
    async ({ route, body }) => {
      const { reads, post } = setup();
      const include = ["dados/grande.py", "b.ts"];
      expect((await post(route, { ...body, include })).status).toBe(404);
      expect(reads).toEqual([{ path: "/loja", include }]);
    },
  );

  it.each(ROUTES)(
    "$route reads with no included file when the body has none",
    async ({ route, body }) => {
      const { reads, post } = setup();
      await post(route, body);
      expect(reads).toEqual([{ path: "/loja", include: undefined }]);
    },
  );

  const BAD = [
    ["a parent folder", ["../fora.py"]],
    ["a parent folder inside", ["a/../../fora.py"]],
    ["a backslash", [String.raw`a\b.py`]],
    ["a leading slash", ["/etc/passwd"]],
    ["a drive", ["C:/x.py"]],
    ["an empty path", [""]],
    ["a non-string", [42]],
    ["not an array", "a.py"],
    ["101 paths", Array.from({ length: 101 }, (_, i) => `f${i}.py`)],
  ] as const;

  for (const { route, body } of ROUTES) {
    it.each(BAD)(
      `${route} answers 400 to %s and reads nothing`,
      async (_name, include) => {
        const { reads, post } = setup();
        const res = await post(route, { ...body, include });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "invalid body" });
        expect(reads).toEqual([]);
      },
    );
  }

  it("accepts exactly 100 paths", async () => {
    const { reads, post } = setup();
    const include = Array.from({ length: 100 }, (_, i) => `f${i}.py`);
    await post("/api/project", { path: "/loja", include });
    expect(reads).toEqual([{ path: "/loja", include }]);
  });
});
