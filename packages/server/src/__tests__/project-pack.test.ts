import type {
  FlowEdge,
  FlowNode,
  Graph,
  LanguageAnalysis,
  LanguagePlugin,
  LinkRequest,
  Offer,
  SourceFile,
} from "@8n8/model";
import { analyzeProject } from "@8n8/project";
import { describe, expect, it } from "vitest";
import { openHistory } from "../history";
import { languagePlugins } from "../plugins";
import { buildInThread } from "../project-build";
import { createProjectStore } from "../project-store";
import { answers, referenceParts } from "./answers";
import { fakeLang } from "./fake-lang";
import { MIXED } from "./mixed";
import { linkedGraph } from "./reference-compact";

const input = (files: SourceFile[], name = "p") => ({
  name,
  files,
  ignored: [],
  version: "v-test",
});

/** The build of the server answers like the plain packing of the whole graph. */
async function sameAsReference(files: SourceFile[], plugins: LanguagePlugin[]) {
  const built = await buildInThread(input(files), plugins);
  expect(answers(built)).toEqual(answers(referenceParts("p", files, plugins)));
  return built;
}

const head = (path: string): FlowNode => ({
  id: `file:${path}`,
  kind: "file",
  label: path,
  parentId: null,
  range: { start: 1, end: 1 },
  openable: true,
  path,
});
const fn = (path: string, name: string): FlowNode => ({
  id: `file:${path}/fn:${name}`,
  kind: "function",
  label: name,
  parentId: `file:${path}`,
  range: { start: 1, end: 1 },
  openable: true,
});
const calls = (source: string, target: string): FlowEdge => ({
  id: `calls:${source}->${target}`,
  kind: "calls",
  source,
  target,
});

const NO_GRAPH: Graph = { language: "x", empty: true, nodes: [], edges: [] };

/** A plugin whose files hold the functions `names`, with the wires and the links `extra` adds. */
function plugin(
  id: string,
  extension: string,
  names: string[],
  extra: (files: SourceFile[]) => Partial<LanguageAnalysis> = () => ({}),
  edges: (path: string) => FlowEdge[] = () => [],
): LanguagePlugin {
  return fakeLang(() => NO_GRAPH, {
    id,
    label: id,
    extensions: [extension],
    analyze: (files) => ({
      files: files.map((f) => ({
        path: f.path,
        graph: {
          language: id,
          empty: false,
          nodes: [head(f.path), ...names.map((n) => fn(f.path, n))],
          edges: edges(f.path),
        },
      })),
      imports: [],
      offers: [],
      requests: [],
      ...extra(files),
    }),
  });
}

const request = (path: string): LinkRequest => ({
  channel: "http",
  key: "POST /api/x",
  nodeId: `file:${path}/fn:call`,
  line: 1,
});
const offer = (path: string): Offer => ({
  channel: "http",
  key: "POST /api/x",
  nodeId: `file:${path}/fn:handler`,
  line: 1,
});
const files = (...paths: string[]): SourceFile[] =>
  paths.map((path) => ({ path, source: "a\nb\n" }));

describe("buildInThread answers like the plain packing of the whole graph", () => {
  it("a project of Python and TypeScript with wires between the languages", async () => {
    const built = await sameAsReference(MIXED, languagePlugins);
    expect(built.cross.length).toBeGreaterThan(0);
    expect(built.counts.files).toBe(MIXED.length);
  });

  it("the history keeps the same counts from the numbers of the build as from the whole response", async () => {
    const built = await buildInThread(input(MIXED, "mista"), languagePlugins);
    const reference = {
      name: "mista",
      files: MIXED,
      ignored: [],
      version: "v-test",
      graph: linkedGraph(analyzeProject(MIXED, languagePlugins), "mista"),
    };
    const fromNumbers = openHistory(":memory:");
    fromNumbers.save({
      kind: "project",
      root: "/m",
      name: built.name,
      counts: built.counts,
    });
    const fromResponse = openHistory(":memory:");
    fromResponse.save({ kind: "project", root: "/m", response: reference });
    const strip = (h: ReturnType<typeof openHistory>) =>
      h.list().map(({ lines, bytes, files, nodes, edges, title }) => ({
        lines,
        bytes,
        files,
        nodes,
        edges,
        title,
      }));
    expect(strip(fromNumbers)).toEqual(strip(fromResponse));
    expect(strip(fromNumbers)[0]?.lines).toBeGreaterThan(0);
    fromNumbers.close();
    fromResponse.close();
  });

  it("the same files give the same parts, whatever the order the reader gave them", async () => {
    const one = await buildInThread(input(MIXED), languagePlugins);
    const two = await buildInThread(
      input([...MIXED].reverse()),
      languagePlugins,
    );
    expect(answers(one)).toEqual(answers(two));
  });

  it("a request meets the route another language offers, and the wire comes after the wires of the graph", async () => {
    const caller = plugin("a", ".a", ["call"], (fs) => ({
      requests: fs.map((f) => request(f.path)),
      imports: [
        {
          id: "imports:file:x.a->file:x.a",
          kind: "imports",
          source: "file:x.a",
          target: "file:x.a",
        },
      ],
    }));
    const handler = plugin("b", ".b", ["handler"], (fs) => ({
      offers: fs.map((f) => offer(f.path)),
    }));
    const built = await sameAsReference(files("x.a", "y.b"), [caller, handler]);
    expect(built.cross).toEqual([
      {
        seq: 1,
        source: "file:x.a/fn:call",
        target: "file:y.b/fn:handler",
      },
    ]);
  });

  it("an ambiguous request links nothing, and an id the graph already has is not added twice", async () => {
    const caller = plugin("a", ".a", ["call"], (fs) => ({
      requests: fs.map((f) => request(f.path)),
    }));
    const handler = plugin("b", ".b", ["handler"], (fs) => ({
      offers: fs.map((f) => offer(f.path)),
    }));
    const ambiguous = await sameAsReference(files("x.a", "y.b", "z.b"), [
      caller,
      handler,
    ]);
    expect(ambiguous.cross).toEqual([]);

    const linkId = "link:http:file:x.a/fn:call->file:y.b/fn:handler";
    const dup = plugin("a", ".a", ["call"], (fs) => ({
      requests: fs.map((f) => request(f.path)),
      imports: [
        { id: linkId, kind: "imports", source: "file:x.a", target: "file:x.a" },
      ],
    }));
    await sameAsReference(files("x.a", "y.b"), [dup, handler]);
  });

  it("a link between two nodes of one file goes into the record of that file, after its own wires", async () => {
    const both = plugin(
      "a",
      ".a",
      ["call", "handler", "other"],
      (fs) => ({
        requests: fs.map((f) => request(f.path)),
        offers: fs.map((f) => offer(f.path)),
      }),
      (path) => [calls(`file:${path}/fn:other`, `file:${path}/fn:handler`)],
    );
    const built = await sameAsReference(files("x.a"), [both]);
    const store = createProjectStore(built);
    expect(store.detailOf("x.a")?.edges.map((e) => e.id)).toEqual([
      "calls:file:x.a/fn:other->file:x.a/fn:handler",
      "link:http:file:x.a/fn:call->file:x.a/fn:handler",
    ]);
    expect(store.callsOf("file:x.a/fn:handler").in).toEqual([
      "file:x.a/fn:other",
      "file:x.a/fn:call",
    ]);
  });

  it("a wire a file's graph keeps for another file lands in that file's record", async () => {
    const odd = plugin(
      "a",
      ".a",
      ["f", "g"],
      () => ({}),
      (path) =>
        path === "x.a"
          ? [calls("file:y.a/fn:f", "file:y.a/fn:g")]
          : [calls("file:y.a/fn:g", "file:y.a/fn:f")],
    );
    // Only the order differs from the plain packing: the file's own wires first, then the ones another file's graph gave it.
    const built = await buildInThread(input(files("x.a", "y.a")), [odd]);
    const store = createProjectStore(built);
    expect(
      store
        .detailOf("y.a")
        ?.edges.map((e) => e.id)
        .sort(),
    ).toEqual([
      "calls:file:y.a/fn:f->file:y.a/fn:g",
      "calls:file:y.a/fn:g->file:y.a/fn:f",
    ]);
  });

  it("a file the plugin cannot read is a file node with a syntax error, as before", async () => {
    const base = plugin("a", ".a", ["f"]);
    const picky: LanguagePlugin = {
      ...base,
      analyze: (fs) => {
        if (fs.some((f) => f.path === "bad.a")) {
          if (fs.length === 1) throw new Error("parser exploded");
          throw new Error("parser exploded");
        }
        return base.analyze(fs);
      },
    };
    const built = await sameAsReference(files("bad.a", "ok.a"), [picky]);
    const store = createProjectStore(built);
    expect(store.nodeOf("file:bad.a")?.syntaxError).toEqual({ line: 1 });
    expect(store.detailOf("ok.a")?.nodes).toHaveLength(2);
  });
});

describe("buildInThread refuses what a plugin got wrong, naming the plugin and the file", () => {
  const tweak = (change: (a: LanguageAnalysis) => LanguageAnalysis) => {
    const base = plugin("bugado", ".a", ["f"]);
    return { ...base, analyze: (fs: SourceFile[]) => change(base.analyze(fs)) };
  };

  it("a node whose id does not start with the id of its file", async () => {
    const bad = tweak((a) => ({
      ...a,
      files: a.files.map((f) => ({
        ...f,
        graph: {
          ...f.graph,
          nodes: f.graph.nodes.map((n) =>
            n.kind === "function" ? { ...n, id: "fn:solto" } : n,
          ),
        },
      })),
    }));
    await expect(buildInThread(input(files("x.a")), [bad])).rejects.toThrow(
      /^plugin "bugado" returned an invalid analysis for x\.a: .*does not carry the id of its file/,
    );
  });

  it("an offer for a node that does not exist, and an import to a missing node", async () => {
    const ghost = tweak((a) => ({
      ...a,
      offers: [offer("zzz.a")],
    }));
    await expect(buildInThread(input(files("x.a")), [ghost])).rejects.toThrow(
      /for http: .* which does not exist/,
    );
  });

  it("the same node id in two files", async () => {
    // Both files claim the node of the first.
    const twin = tweak((a) => ({
      ...a,
      files: a.files.map((f) => ({
        ...f,
        graph: { ...f.graph, nodes: [f.graph.nodes[0] as FlowNode] },
      })),
    }));
    await expect(
      buildInThread(input(files("x.a", "y.a")), [twin]),
    ).resolves.toBeDefined();
  });
});
