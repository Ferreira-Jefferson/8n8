import type {
  FileDetail,
  FlowEdge,
  FlowNode,
  ProjectSkeleton,
  SearchHit,
} from "@8n8/model";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { ProjectRead } from "../project-index";
import { detailOf, searchOf, skeletonOf } from "../project-views";
import { fakeLang } from "./fake-lang";
import { TEST_TOKEN } from "./test-token";

const node = (
  id: string,
  kind: FlowNode["kind"],
  parentId: string | null,
  extra: Partial<FlowNode> = {},
): FlowNode => ({
  id,
  kind,
  label: id,
  parentId,
  range: { start: 1, end: 3 },
  openable: true,
  ...extra,
});
const edge = (
  kind: FlowEdge["kind"],
  source: string,
  target: string,
): FlowEdge => ({ id: `${kind}:${source}->${target}`, kind, source, target });

const built = (): Extract<ProjectRead, { kind: "ok" }> => ({
  kind: "ok",
  root: "/p",
  response: {
    name: "p",
    ignored: [{ path: "big.py", reason: "too-large" }],
    version: "v1",
    files: [
      { path: "app/a.py", source: "def f():\n  g()\n  h()\n" },
      { path: "b.py", source: "def h():\n  pass\n" },
    ],
    graph: {
      language: "python",
      empty: false,
      project: { name: "p" },
      nodes: [
        node("dir:app", "folder", null, { path: "app", label: "app" }),
        node("file:app/a.py", "file", "dir:app", {
          path: "app/a.py",
          label: "a.py",
        }),
        node("file:app/a.py/fn:f", "function", "file:app/a.py", {
          label: "f",
        }),
        node("file:app/a.py/fn:f/s1", "call", "file:app/a.py/fn:f", {
          label: "g",
          target: "file:app/a.py/fn:g",
        }),
        node("file:app/a.py/fn:f/s2", "call", "file:app/a.py/fn:f", {
          label: "h",
          target: "file:b.py/fn:h",
        }),
        node("file:app/a.py/fn:g", "function", "file:app/a.py", {
          label: "g",
        }),
        node("file:b.py", "file", null, { path: "b.py", label: "b.py" }),
        node("file:b.py/fn:h", "function", "file:b.py", {
          label: "h",
          docstring: { start: 2, end: 2 },
        }),
      ],
      edges: [
        edge("calls", "file:app/a.py/fn:f", "file:app/a.py/fn:g"),
        edge("calls", "file:app/a.py/fn:f", "file:b.py/fn:h"),
        edge("imports", "file:app/a.py", "file:b.py"),
      ],
    },
  },
});

describe("skeletonOf", () => {
  it("answers the counts of the full graph and the version of the build", () => {
    const skeleton = skeletonOf(built());
    expect(skeleton).toMatchObject({
      name: "p",
      version: "v1",
      stats: { files: 2, nodes: 8, edges: 3 },
      ignored: [{ path: "big.py", reason: "too-large" }],
    });
    expect(skeleton.graph.nodes.map((n) => n.id)).toEqual([
      "dir:app",
      "file:app/a.py",
      "file:b.py",
    ]);
  });

  it("is made once for the same read", () => {
    const read = built();
    expect(skeletonOf(read)).toBe(skeletonOf(read));
  });
});

describe("detailOf", () => {
  it("gives the file, its descendants, its own wires and the file of each outside target", () => {
    const detail = detailOf(built(), "app/a.py");
    expect(detail?.source).toBe("def f():\n  g()\n  h()\n");
    expect(detail?.nodes.map((n) => n.id)).toEqual([
      "file:app/a.py",
      "file:app/a.py/fn:f",
      "file:app/a.py/fn:f/s1",
      "file:app/a.py/fn:f/s2",
      "file:app/a.py/fn:g",
    ]);
    expect(detail?.edges.map((e) => e.id)).toEqual([
      "calls:file:app/a.py/fn:f->file:app/a.py/fn:g",
    ]);
    expect(detail?.refs).toEqual({ "file:app/a.py/fn:f/s2": "b.py" });
  });

  it("is undefined for a file the project does not have", () => {
    expect(detailOf(built(), "nada.py")).toBeUndefined();
  });
});

describe("searchOf", () => {
  const ids = (hits: SearchHit[]) => hits.map((h) => h.node.id);

  it("finds by the words of the name in any order, with the ancestry from the top", () => {
    const hits = searchOf(built(), "F app");
    expect(ids(hits)).toEqual([]);
    const fn = searchOf(built(), "f()");
    expect(ids(fn)).toEqual(["file:app/a.py/fn:f"]);
    expect(fn[0]?.ancestry).toEqual(["dir:app", "file:app/a.py"]);
  });

  it("looks at folders and files by path, and skips calls and steps", () => {
    expect(ids(searchOf(built(), "app"))).toEqual(["dir:app", "file:app/a.py"]);
    // The calls to `g` and `h` inside `f` are steps: only the function `g` answers.
    expect(ids(searchOf(built(), "g"))).toEqual(["file:app/a.py/fn:g"]);
  });

  it("answers nothing to a blank query and keeps to the limit", () => {
    expect(searchOf(built(), "  ")).toEqual([]);
    expect(searchOf(built(), "a", 1)).toHaveLength(1);
  });
});

describe("POST /api/project with lazy, /file and /search", () => {
  const read = built();
  const app = createApp({
    plugins: [fakeLang(() => read.response.graph)],
    explain: async () => ({ status: "no-key" }),
    titles: async () => ({ status: "ok", titles: [] }),
    readProject: async () => read,
    port: 8148,
    token: TEST_TOKEN,
  });
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: {
        host: "127.0.0.1:8148",
        "content-type": "application/json",
        "x-8n8-token": TEST_TOKEN,
      },
      body: JSON.stringify(body),
    });

  it("lazy answers the skeleton; without it the full graph, with no files, as before", async () => {
    const lazy = (await (
      await post("/api/project", { path: "/p", lazy: true })
    ).json()) as ProjectSkeleton;
    expect(lazy.graph.nodes).toHaveLength(3);
    expect(lazy.stats.files).toBe(2);
    const full = (await (
      await post("/api/project", { path: "/p" })
    ).json()) as {
      graph: { nodes: unknown[] };
      files?: unknown;
      stats?: unknown;
    };
    expect(full.graph.nodes).toHaveLength(8);
    expect(full.files).toBeUndefined();
    expect(full.stats).toBeUndefined();
  });

  it("/file answers the detail of the file", async () => {
    const res = await post("/api/project/file", {
      root: "/p",
      path: "app/a.py",
      version: "v1",
    });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as FileDetail;
    expect(detail.nodes).toHaveLength(5);
    expect(detail.refs).toEqual({ "file:app/a.py/fn:f/s2": "b.py" });
  });

  it("/search answers the hits, 409 for an old version and 400 for a long query", async () => {
    const ok = await post("/api/project/search", {
      root: "/p",
      query: "h",
      version: "v1",
    });
    expect(ok.status).toBe(200);
    const { hits } = (await ok.json()) as { hits: SearchHit[] };
    expect(hits.map((h) => h.node.id)).toContain("file:b.py/fn:h");
    const stale = await post("/api/project/search", {
      root: "/p",
      query: "h",
      version: "v0",
    });
    expect(stale.status).toBe(409);
    const long = await post("/api/project/search", {
      root: "/p",
      query: "x".repeat(201),
    });
    expect(long.status).toBe(400);
  });
});
