import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pythonPlugin } from "@8n8/lang-python";
import type {
  ExplainRequest,
  FlowNode,
  Graph,
  LanguageAnalysis,
  LanguagePlugin,
  LinkRequest,
  Offer,
  SourceFile,
  TitleRequest,
} from "@8n8/model";
import { buildProject } from "@8n8/project";
import { afterAll, describe, expect, it } from "vitest";
import {
  composeExplain,
  composeLlm,
  composeReadProject,
  composeTitles,
} from "../core";
import { fakeLang } from "./fake-lang";

const cacheDir = mkdtempSync(join(tmpdir(), "8n8-langs-"));
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));
let n = 0;
const freshDir = () => join(cacheDir, `c${n++}`);

const noGraph = (): Graph => ({
  language: "x",
  empty: true,
  nodes: [],
  edges: [],
});
const ts = fakeLang(noGraph, {
  id: "typescript",
  label: "TypeScript",
  extensions: [".ts"],
  commentPrefix: "//",
});
const py = fakeLang(noGraph, { id: "python", label: "Python" });
const plugins = [py, ts];

/** A client that answers drafts, verdicts and titles for whatever it is asked, and records the system prompts. */
function fakeLlm() {
  const drafts: string[] = [];
  const reviews: string[] = [];
  const client = {
    async complete(r: { messages: { role: string; content: string }[] }) {
      const system = r.messages.find((m) => m.role === "system")?.content ?? "";
      const user = r.messages.find((m) => m.role === "user")?.content ?? "";
      if (system.includes('"verdicts"')) {
        reviews.push(system);
        const verdicts = [...user.matchAll(/^- (\w+): /gm)].map(([, id]) => ({
          id,
          supported: true,
          evidence: [1],
        }));
        return JSON.stringify({ verdicts });
      }
      drafts.push(system);
      if (system.startsWith("Você escreve títulos")) {
        const ids = [...user.matchAll(/^\[(n\d+)\]/gm)].map(([, id]) => id);
        return JSON.stringify({
          titles: ids.map((id) => ({ id, title: "Devolver um" })),
        });
      }
      return JSON.stringify({
        summary: "s",
        inputs: [],
        outputs: [],
        suggestions: [],
      });
    },
  };
  return { client, drafts, reviews };
}

const env = { OPENROUTER_API_KEY: "k" };
const compose = (llm: ReturnType<typeof fakeLlm>, dir = freshDir()) => ({
  llm: composeLlm(env, () => llm.client),
  plugins,
  ptsRules: "REGRAS",
  cacheDir: dir,
});

const request = (language: string, over: Partial<ExplainRequest> = {}) =>
  ({
    nodeId: `${language}|fn:f`,
    language,
    nodeName: "f",
    nodeKind: "function",
    code: "function f() {\n  return 1;\n}",
    range: { start: 1, end: 3 },
    calls: [],
    calledBy: [],
    ...over,
  }) satisfies ExplainRequest;

describe("composeExplain by language (6.1-6.3)", () => {
  it("each request gets the prompts of its own language, with its marker", async () => {
    const llm = fakeLlm();
    const explain = composeExplain(env, compose(llm));
    await explain(request("typescript"));
    await explain(request("python"));
    const [ofTs, ofPy] = llm.drafts;
    expect(ofTs).toContain("código TypeScript");
    expect(ofTs).toContain("`// docstring omitida`");
    expect(ofTs).not.toContain("Python");
    expect(ofPy).toContain("código Python");
    expect(ofPy).toContain("`# docstring omitida`");
    expect(llm.reviews[0]).toContain("código TypeScript");
    expect(llm.reviews[1]).toContain("código Python");
  });

  it("the same node name and code in two languages never share a cache entry", async () => {
    const llm = fakeLlm();
    const explain = composeExplain(env, compose(llm));
    const same = { code: "f()", range: { start: 1, end: 1 } };
    expect(await explain(request("python", same))).toMatchObject({
      status: "ok",
      fromCache: false,
    });
    expect(await explain(request("typescript", same))).toMatchObject({
      status: "ok",
      fromCache: false,
    });
    // Each one hits its own entry now.
    expect(await explain(request("python", same))).toMatchObject({
      fromCache: true,
    });
    expect(await explain(request("typescript", same))).toMatchObject({
      fromCache: true,
    });
    expect(llm.drafts).toHaveLength(2);
  });

  it("a language without prompts is an error, never another language's prompt", async () => {
    const llm = fakeLlm();
    const explain = composeExplain(env, compose(llm));
    expect(await explain(request("ruby"))).toEqual({
      status: "error",
      message: "Não há prompt para a linguagem ruby.",
    });
    expect(llm.drafts).toEqual([]);
  });
});

const item = (language: string, id: string): TitleRequest["items"][number] => ({
  nodeId: id,
  cacheKey: `/p|${id}`,
  language,
  kind: "function",
  name: "f",
  code: "f()",
  range: { start: 1, end: 1 },
  calls: [],
  calledBy: [],
});

describe("composeTitles by language (6.1, 6.3)", () => {
  it("a mixed request is split by language, and the titles come back in the order of the items", async () => {
    const llm = fakeLlm();
    const titles = composeTitles(env, compose(llm));
    const res = await titles({
      items: [
        item("typescript", "b"),
        item("python", "a"),
        item("typescript", "c"),
      ],
    });
    expect(res.status).toBe("ok");
    expect(res.titles.map((t) => t.nodeId)).toEqual(["b", "a", "c"]);
    // Two title calls, one per language, each with its own prompt.
    expect(llm.drafts).toHaveLength(2);
    expect(llm.drafts[0]).toContain("código TypeScript");
    expect(llm.drafts[1]).toContain("código Python");
  });

  it("the same node id in two languages has two cache entries", async () => {
    const llm = fakeLlm();
    const titles = composeTitles(env, compose(llm));
    const a = { ...item("python", "x"), cacheKey: "python|fn:f" };
    const b = { ...item("typescript", "x"), cacheKey: "typescript|fn:f" };
    await titles({ items: [a] });
    const second = await titles({ items: [b] });
    expect(second.titles[0]?.fromCache).toBe(false);
    expect((await titles({ items: [a] })).titles[0]?.fromCache).toBe(true);
    expect(llm.drafts).toHaveLength(2);
  });

  it("without a key every group says no-key", async () => {
    const llm = fakeLlm();
    const titles = composeTitles(
      {},
      { ...compose(llm), llm: composeLlm({}, () => undefined) },
    );
    expect(
      await titles({ items: [item("python", "a"), item("typescript", "b")] }),
    ).toEqual({ status: "no-key", titles: [] });
  });

  it("a language without prompts is an error that keeps the titles of the others", async () => {
    const llm = fakeLlm();
    const titles = composeTitles(env, compose(llm));
    const res = await titles({
      items: [item("ruby", "r"), item("python", "a")],
    });
    expect(res).toMatchObject({
      status: "error",
      message: "Não há prompt para a linguagem ruby.",
    });
    expect(res.titles.map((t) => t.nodeId)).toEqual(["a"]);
  });

  it("an empty request is ok and calls nothing", async () => {
    const llm = fakeLlm();
    expect(await composeTitles(env, compose(llm))({ items: [] })).toEqual({
      status: "ok",
      titles: [],
    });
    expect(llm.drafts).toEqual([]);
  });
});

/** A file graph: the file node and one function node, ids prefixed by the file id. */
function fileGraph(file: SourceFile, language: string, fn: string): Graph {
  const id = `file:${file.path}`;
  const head: FlowNode = {
    id,
    kind: "file",
    label: file.path,
    parentId: null,
    range: { start: 1, end: 1 },
    openable: true,
    path: file.path,
  };
  const inner: FlowNode = {
    id: `${id}/fn:${fn}`,
    kind: "function",
    label: fn,
    parentId: id,
    range: { start: 1, end: 1 },
    openable: true,
  };
  return { language, empty: false, nodes: [head, inner], edges: [] };
}

function linkable(
  id: string,
  extension: string,
  fn: string,
  extra: (file: SourceFile) => Partial<LanguageAnalysis>,
): LanguagePlugin {
  return fakeLang(noGraph, {
    id,
    label: id,
    extensions: [extension],
    analyze: (files) => ({
      files: files.map((f) => ({ path: f.path, graph: fileGraph(f, id, fn) })),
      imports: [],
      offers: [],
      requests: [],
      ...files.reduce<Partial<LanguageAnalysis>>(
        (acc, f) => ({
          offers: [...(acc.offers ?? []), ...(extra(f).offers ?? [])],
          requests: [...(acc.requests ?? []), ...(extra(f).requests ?? [])],
          imports: [...(acc.imports ?? []), ...(extra(f).imports ?? [])],
        }),
        {},
      ),
    }),
  });
}

const ROUTE = "POST /api/frete";
const requestOf = (path: string): LinkRequest => ({
  channel: "http",
  key: ROUTE,
  nodeId: `file:${path}/fn:call`,
  line: 1,
});
const offerOf = (path: string): Offer => ({
  channel: "http",
  key: ROUTE,
  nodeId: `file:${path}/fn:handler`,
  line: 1,
});

function readerOf(files: SourceFile[], using: LanguagePlugin[]) {
  return composeReadProject(
    async () => ({ kind: "ok", name: "mix", root: "/mix", files, ignored: [] }),
    using,
  )("/mix");
}

const callerFile = { path: "x.a", source: "call()\n" };
const handlerFile = { path: "y.b", source: "handler()\n" };

describe("composeReadProject links the languages (D3, D4)", () => {
  const caller = linkable("a", ".a", "call", (f) => ({
    requests: f.path === "x.a" ? [requestOf(f.path)] : [],
  }));
  const handler = linkable("b", ".b", "handler", (f) => ({
    offers: [offerOf(f.path)],
  }));

  it("a request in one language meets the route another one offers", async () => {
    const read = await readerOf([callerFile, handlerFile], [caller, handler]);
    if (read.kind !== "ok") throw new Error("expected ok");
    const { graph } = read.response;
    expect(graph.language).toBe("mixed");
    expect(graph.edges).toEqual([
      {
        id: "link:http:file:x.a/fn:call->file:y.b/fn:handler",
        kind: "calls",
        source: "file:x.a/fn:call",
        target: "file:y.b/fn:handler",
        label: "HTTP POST /api/frete",
      },
    ]);
    // The nodes are the ones the plugins made, nothing is added.
    expect(graph.nodes.map((nd) => nd.id)).toEqual([
      "file:x.a",
      "file:x.a/fn:call",
      "file:y.b",
      "file:y.b/fn:handler",
    ]);
  });

  it("the wires come after the wires of the graph", async () => {
    const withImport = linkable("a", ".a", "call", (f) => ({
      requests: [requestOf(f.path)],
      imports: [
        {
          id: "imports:file:x.a->file:x.a",
          kind: "imports",
          source: "file:x.a",
          target: "file:x.a",
        },
      ],
    }));
    const read = await readerOf(
      [callerFile, handlerFile],
      [withImport, handler],
    );
    if (read.kind !== "ok") throw new Error("expected ok");
    expect(read.response.graph.edges.map((e) => e.kind)).toEqual([
      "imports",
      "calls",
    ]);
  });

  it("an id that the graph already has is not added twice", async () => {
    const linkId = "link:http:file:x.a/fn:call->file:y.b/fn:handler";
    const dup = linkable("a", ".a", "call", (f) => ({
      requests: [requestOf(f.path)],
      imports: [
        {
          id: linkId,
          kind: "imports",
          source: "file:x.a",
          target: "file:x.a",
        },
      ],
    }));
    const read = await readerOf([callerFile, handlerFile], [dup, handler]);
    if (read.kind !== "ok") throw new Error("expected ok");
    expect(read.response.graph.edges.map((e) => e.id)).toEqual([linkId]);
  });

  it("an ambiguous request links nothing", async () => {
    const read = await readerOf(
      [callerFile, handlerFile, { path: "z.b", source: "handler()\n" }],
      [caller, handler],
    );
    if (read.kind !== "ok") throw new Error("expected ok");
    expect(read.response.graph.edges).toEqual([]);
  });

  it("a one-language project is byte for byte what buildProject gives", async () => {
    const files = [
      { path: "a.py", source: "import requests\n\ndef f():\n    return g()\n" },
      { path: "b.py", source: "def g():\n    requests.get('x')\n" },
    ];
    const read = await readerOf(files, [pythonPlugin]);
    if (read.kind !== "ok") throw new Error("expected ok");
    expect(JSON.stringify(read.response.graph)).toBe(
      JSON.stringify({
        ...buildProject(files, [pythonPlugin]),
        project: { name: "mix" },
      }),
    );
  });
});
