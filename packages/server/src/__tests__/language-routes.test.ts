import type {
  ExplainRequest,
  FlowNode,
  Graph,
  GraphResponse,
  LanguagePlugin,
  LanguagesResponse,
  TitleRequest,
} from "@8n8/model";
import { describe, expect, it, vi } from "vitest";
import { type AppDeps, createApp, type ProjectRead } from "../app";
import { openHistory } from "../history";
import { fakeLang } from "./fake-lang";
import { TEST_TOKEN } from "./test-token";

const fn = (
  id: string,
  parentId: string | null,
  docstring?: { start: number; end: number },
): FlowNode => ({
  id,
  kind: "function",
  label: "f",
  parentId,
  range: { start: 1, end: 4 },
  openable: true,
  ...(docstring ? { docstring } : {}),
});

const graphOf = (language: string, nodes: FlowNode[]): Graph => ({
  language,
  empty: false,
  nodes,
  edges: [],
});

/** Scores by a keyword: 0.9 when the source has it, 0.1 otherwise. */
const py: LanguagePlugin = fakeLang(
  () => graphOf("python", [fn("fn:f", null, { start: 2, end: 2 })]),
  { detect: (s) => (s.includes("def ") ? 0.9 : 0.1) },
);
const ts: LanguagePlugin = fakeLang(
  () => graphOf("typescript", [fn("fn:f", null, { start: 2, end: 2 })]),
  {
    id: "typescript",
    label: "TypeScript",
    extensions: [".ts"],
    commentPrefix: "//",
    detect: (s) => (s.includes("function ") ? 0.9 : 0.1),
  },
);

const PY_SOURCE = "def f():\n    '''Doc.'''\n    return 1\n";
const TS_SOURCE = "function f() {\n  /** Doc. */\n  return 1;\n}";

interface Setup {
  post: (path: string, body: unknown) => Promise<Response>;
  get: (path: string) => Promise<Response>;
  explained: ExplainRequest[];
  titled: TitleRequest[];
}

function setup(over: Partial<AppDeps> = {}): Setup {
  const explained: ExplainRequest[] = [];
  const titled: TitleRequest[] = [];
  const app = createApp({
    plugins: [py, ts],
    explain: async (_part, req) => {
      explained.push(req);
      return { status: "no-key" };
    },
    titles: async (req) => {
      titled.push(req);
      return { status: "ok", titles: [] };
    },
    readProject: async () => ({ kind: "not-found" }),
    port: 8148,
    token: TEST_TOKEN,
    ...over,
  });
  const headers = {
    host: "127.0.0.1:8148",
    "x-8n8-token": TEST_TOKEN,
    "content-type": "application/json",
  };
  return {
    post: async (path, body) =>
      app.request(path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    get: async (path) => app.request(path, { headers }),
    explained,
    titled,
  };
}

describe("GET /api/languages", () => {
  it("lists the registered plugins in their order, with id, label and extensions only", async () => {
    const res = await setup().get("/api/languages");
    expect(res.status).toBe(200);
    const body = (await res.json()) as LanguagesResponse;
    expect(body).toEqual({
      languages: [
        { id: "python", label: "Python", extensions: [".py"] },
        { id: "typescript", label: "TypeScript", extensions: [".ts"] },
      ],
    });
  });

  it("is an empty list without plugins", async () => {
    const res = await setup({ plugins: [] }).get("/api/languages");
    expect(await res.json()).toEqual({ languages: [] });
  });
});

describe("POST /api/graph picks the language by score (5.2, 5.2a)", () => {
  it("answers the graph and the language of the best score", async () => {
    const s = setup();
    const ofTs = (await (
      await s.post("/api/graph", { source: TS_SOURCE })
    ).json()) as GraphResponse;
    expect(ofTs.language).toEqual({
      id: "typescript",
      label: "TypeScript",
      uncertain: false,
    });
    expect(ofTs.graph.language).toBe("typescript");

    const ofPy = (await (
      await s.post("/api/graph", { source: PY_SOURCE })
    ).json()) as GraphResponse;
    expect(ofPy.language).toEqual({
      id: "python",
      label: "Python",
      uncertain: false,
    });
  });

  it("an ambiguous snippet goes to the first plugin and is marked uncertain", async () => {
    const res = await setup().post("/api/graph", { source: "x = 1" });
    const body = (await res.json()) as GraphResponse;
    expect(body.language).toEqual({
      id: "python",
      label: "Python",
      uncertain: true,
    });
  });

  it("saves the language in the history: the same text in two languages is two entries", async () => {
    const history = openHistory(":memory:");
    const both: LanguagePlugin[] = [
      { ...py, detect: () => 0.9 },
      { ...ts, detect: () => 0.1 },
    ];
    const onlyTs: LanguagePlugin[] = [{ ...ts, detect: () => 0.9 }];
    const text = "same text";
    await setup({ plugins: both, history }).post("/api/graph", {
      source: text,
    });
    await setup({ plugins: onlyTs, history }).post("/api/graph", {
      source: text,
    });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(history.list()).toHaveLength(2);
    history.close();
  });
});

describe("a failing extractor is a JSON 500 and the server goes on (5.7)", () => {
  const boom = fakeLang(
    (s) => {
      if (s.includes("boom")) throw new Error("parser exploded");
      return graphOf("python", [fn("fn:f", null)]);
    },
    { detect: () => 1 },
  );

  it("/api/graph", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = setup({ plugins: [boom] });
    const res = await s.post("/api/graph", { source: "boom" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "extract-failed",
      message: "parser exploded",
    });
    expect((await s.post("/api/graph", { source: "fine" })).status).toBe(200);
  });

  it("/api/graph without plugins says so", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await setup({ plugins: [] }).post("/api/graph", {
      source: "x",
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "extract-failed",
      message: "no language plugin registered",
    });
  });

  it("/api/graph with a throw that is not an Error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const odd = fakeLang(() => {
      throw "texto";
    });
    const res = await setup({ plugins: [odd] }).post("/api/graph", {
      source: "x",
    });
    expect(await res.json()).toEqual({
      error: "extract-failed",
      message: "texto",
    });
  });

  it("/api/summary and /api/titles", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = setup({ plugins: [boom] });
    for (const [path, body] of [
      ["/api/summary", { source: "boom", nodeId: "fn:f" }],
      ["/api/titles", { source: "boom", nodeIds: ["fn:f"] }],
    ] as const) {
      const res = await s.post(path, body);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "extract-failed",
        message: "parser exploded",
      });
    }
    expect(s.explained).toEqual([]);
    expect(s.titled).toEqual([]);
  });
});

describe("a snippet request follows the detected language (5.4, 6.3)", () => {
  it("explain: language, cache identity and the comment prefix of the plugin", async () => {
    const s = setup();
    await s.post("/api/summary", { source: TS_SOURCE, nodeId: "fn:f" });
    await s.post("/api/summary", { source: PY_SOURCE, nodeId: "fn:f" });
    const [ofTs, ofPy] = s.explained;
    expect(ofTs).toMatchObject({
      nodeId: "typescript|fn:f",
      language: "typescript",
      code: "function f() {\n// docstring omitida\n  return 1;\n}",
      docstring: { text: "  /** Doc. */", line: 2 },
    });
    expect(ofPy).toMatchObject({
      nodeId: "python|fn:f",
      language: "python",
      code: "def f():\n# docstring omitida\n    return 1\n",
    });
  });

  it("titles: the cache key and the language of every item", async () => {
    const s = setup();
    await s.post("/api/titles", { source: TS_SOURCE, nodeIds: ["fn:f"] });
    expect(s.titled[0]?.items).toMatchObject([
      { nodeId: "fn:f", cacheKey: "typescript|fn:f", language: "typescript" },
    ]);
  });
});

describe("a project request follows the language of each file (5.4, 6.3)", () => {
  const files = [
    { path: "a.py", source: PY_SOURCE },
    { path: "b.ts", source: TS_SOURCE },
  ];
  const file = (path: string): FlowNode => ({
    id: `file:${path}`,
    kind: "file",
    label: path,
    parentId: null,
    range: { start: 1, end: 4 },
    openable: true,
    path,
  });
  const mixed: Graph = graphOf("mixed", [
    file("a.py"),
    fn("file:a.py/fn:f", "file:a.py", { start: 2, end: 2 }),
    file("b.ts"),
    fn("file:b.ts/fn:f", "file:b.ts", { start: 2, end: 2 }),
    file("c.zzz"),
    fn("file:c.zzz/fn:f", "file:c.zzz"),
  ]);
  const read: ProjectRead = {
    kind: "ok",
    root: "/p",
    response: {
      name: "p",
      graph: mixed,
      files: [...files, { path: "c.zzz", source: "x\n\n\n" }],
      ignored: [],
    },
  };

  it("explain: each node gets the plugin of its file", async () => {
    const s = setup({ readProject: async () => read });
    await s.post("/api/summary", { root: "/p", nodeId: "file:a.py/fn:f" });
    await s.post("/api/summary", { root: "/p", nodeId: "file:b.ts/fn:f" });
    expect(s.explained).toMatchObject([
      {
        nodeId: "/p|file:a.py/fn:f",
        language: "python",
        code: "def f():\n# docstring omitida\n    return 1\n",
      },
      {
        nodeId: "/p|file:b.ts/fn:f",
        language: "typescript",
        code: "function f() {\n// docstring omitida\n  return 1;\n}",
      },
    ]);
  });

  it("titles: a mixed project sends the language of each item", async () => {
    const s = setup({ readProject: async () => read });
    await s.post("/api/titles", {
      root: "/p",
      nodeIds: ["file:a.py/fn:f", "file:b.ts/fn:f"],
    });
    expect(s.titled[0]?.items.map((i) => [i.cacheKey, i.language])).toEqual([
      ["/p|file:a.py/fn:f", "python"],
      ["/p|file:b.ts/fn:f", "typescript"],
    ]);
  });

  it("a node of a file no plugin serves is an extract failure, not a crash", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = setup({ readProject: async () => read });
    const res = await s.post("/api/summary", {
      root: "/p",
      nodeId: "file:c.zzz/fn:f",
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "extract-failed",
      message: "no language plugin for c.zzz",
    });
  });
});
