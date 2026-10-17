import { gunzipSync } from "node:zlib";
import type {
  FlowEdge,
  FlowNode,
  Graph,
  ProjectData,
  SourceFile,
} from "@8n8/model";
import { analyzeProject } from "@8n8/project";
import { describe, expect, it } from "vitest";
import { MAX_HITS } from "../app";
import { languagePlugins } from "../plugins";
import { linkedGraph } from "../project-build";
import { compactProject } from "../project-compact";
import {
  createProjectStore,
  type FileRecord,
  fileOfId,
} from "../project-store";
import { storeOf } from "./read-of";
import { indexOf } from "./reference-index";
import { detailOf, searchOf, skeletonOf } from "./reference-views";

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
const calls = (source: string, target: string): FlowEdge => ({
  id: `calls:${source}->${target}`,
  kind: "calls",
  source,
  target,
});

const data = (): ProjectData & { version: string } => ({
  name: "p",
  ignored: [],
  version: "v1",
  files: [
    { path: "a.py", source: "def f():\n  g()\n" },
    { path: "b.py", source: "def g():\n  pass\n" },
  ],
  graph: {
    language: "python",
    empty: false,
    project: { name: "p" },
    nodes: [
      node("dir:.", "folder", null, { path: "" }),
      node("file:a.py", "file", "dir:.", { path: "a.py" }),
      node("file:a.py/fn:f", "function", "file:a.py", {
        docstring: { start: 2, end: 2 },
      }),
      node("file:a.py/fn:f/s1", "code", "file:a.py/fn:f"),
      node("file:b.py", "file", "dir:.", { path: "b.py" }),
      node("file:b.py/fn:g", "function", "file:b.py"),
    ],
    edges: [
      calls("file:a.py/fn:f", "file:b.py/fn:g"),
      { id: "i", kind: "imports", source: "file:a.py", target: "file:b.py" },
    ],
  },
});

describe("fileOfId", () => {
  const files = new Set(["a.py", "src/b.ts", "src/b.ts.d/c.ts"]);

  it("takes the longest file the id starts with, at any depth", () => {
    expect(fileOfId("file:a.py", files)).toBe("a.py");
    expect(fileOfId("file:a.py/fn:f/s1", files)).toBe("a.py");
    expect(fileOfId("file:src/b.ts/cls:C/fn:m", files)).toBe("src/b.ts");
    expect(fileOfId("file:src/b.ts.d/c.ts/fn:x", files)).toBe(
      "src/b.ts.d/c.ts",
    );
  });

  it("gives none for a folder, for an id with no file and for a missing file", () => {
    expect(fileOfId("dir:src", files)).toBe("");
    expect(fileOfId("dir:.", files)).toBe("");
    expect(fileOfId("file:other.py/fn:f", files)).toBe("");
    expect(fileOfId("fn:f", files)).toBe("");
  });
});

describe("createProjectStore", () => {
  it("finds a node in the folders and in the files, and none for an unknown id", () => {
    const store = storeOf(data());
    expect(store.nodeOf("dir:.")?.kind).toBe("folder");
    expect(store.nodeOf("file:b.py")?.kind).toBe("file");
    expect(store.nodeOf("file:a.py/fn:f/s1")?.kind).toBe("code");
    expect(store.nodeOf("file:a.py/fn:nada")).toBeUndefined();
    expect(store.nodeOf("file:zzz.py")).toBeUndefined();
  });

  it("finds the file of a node at any depth, and none for a folder", () => {
    const store = storeOf(data());
    expect(store.filePathOf("file:a.py/fn:f/s1")).toBe("a.py");
    expect(store.filePathOf("file:b.py")).toBe("b.py");
    expect(store.filePathOf("dir:.")).toBe("");
    expect(store.filePathOf("missing")).toBe("");
  });

  it("keeps the source and the docstrings of each file", () => {
    const store = storeOf(data());
    expect(store.sourceOf("b.py")).toBe("def g():\n  pass\n");
    expect(store.sourceOf("nada.py")).toBeUndefined();
    expect(store.docstringsOf("a.py")).toEqual([{ start: 2, end: 2 }]);
    expect(store.docstringsOf("b.py")).toEqual([]);
  });

  it("keeps the calls in both directions and ignores other edges", () => {
    const store = storeOf(data());
    expect(store.callsOf("file:a.py/fn:f").out).toEqual(["file:b.py/fn:g"]);
    expect(store.callsOf("file:b.py/fn:g").in).toEqual(["file:a.py/fn:f"]);
    expect(store.callsOf("file:a.py")).toEqual({ out: [], in: [] });
  });

  it("puts the calls inside a file and the calls between files in the order of the graph", () => {
    const f = "file:a.py/fn:f";
    const t = "file:b.py/fn:t";
    const graph: Graph = {
      language: "python",
      empty: false,
      nodes: [
        node("file:a.py", "file", null, { path: "a.py" }),
        node(f, "function", "file:a.py"),
        node("file:a.py/fn:g", "function", "file:a.py"),
        node("file:a.py/fn:k", "function", "file:a.py"),
        node("file:b.py", "file", null, { path: "b.py" }),
        node(t, "function", "file:b.py"),
        node("file:b.py/fn:u", "function", "file:b.py"),
        node("file:c.py", "file", null, { path: "c.py" }),
        node("file:c.py/fn:v", "function", "file:c.py"),
      ],
      edges: [
        calls(f, "file:a.py/fn:g"),
        calls(f, t),
        calls("file:c.py/fn:v", t),
        calls(f, "file:a.py/fn:k"),
        calls("file:b.py/fn:u", t),
        calls("file:a.py/fn:k", t),
      ],
    };
    const store = createProjectStore(
      compactProject({
        name: "p",
        files: ["a.py", "b.py", "c.py"].map((path) => ({ path, source: "" })),
        ignored: [],
        version: "v",
        graph,
      }),
    );
    expect(store.callsOf(f).out).toEqual([
      "file:a.py/fn:g",
      t,
      "file:a.py/fn:k",
    ]);
    expect(store.callsOf(t).in).toEqual([
      f,
      "file:c.py/fn:v",
      "file:b.py/fn:u",
      "file:a.py/fn:k",
    ]);
  });

  it("keeps only a few files unpacked, the ones asked for last", () => {
    const store = createProjectStore(
      compactProject({
        ...data(),
        graph: data().graph,
        files: data().files,
      }),
      1,
    );
    const first = store.detailOf("a.py")?.nodes;
    expect(store.detailOf("a.py")?.nodes).toBe(first);
    store.detailOf("b.py");
    expect(store.detailOf("a.py")?.nodes).not.toBe(first);
    expect(store.detailOf("a.py")?.nodes).toEqual(first);
  });

  it("unpacks to what was packed: the source, the nodes, the inner wires and where each one lay", () => {
    const parts = compactProject({ ...data(), graph: data().graph });
    const unit = parts.files.find((u) => u.path === "a.py");
    const record = JSON.parse(
      gunzipSync(unit?.blob ?? new Uint8Array()).toString("utf8"),
    ) as FileRecord;
    expect(record.source).toBe("def f():\n  g()\n");
    expect(record.nodes.map((n) => n.id)).toEqual([
      "file:a.py",
      "file:a.py/fn:f",
      "file:a.py/fn:f/s1",
    ]);
    // Both wires leave the file: the call goes to the small index, the import to the skeleton.
    expect(record.edges).toEqual([]);
    expect(parts.cross).toEqual([
      { seq: 0, source: "file:a.py/fn:f", target: "file:b.py/fn:g" },
    ]);
    expect(unit?.hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it("counts what the history keeps", () => {
    const { counts } = createProjectStore(
      compactProject({ ...data(), graph: data().graph }),
    );
    expect(counts).toEqual({
      lines: 6,
      bytes: 31,
      files: 2,
      nodes: 6,
      edges: 2,
    });
  });

  it("refuses a node whose id does not start with the id of its file", () => {
    const graph = data().graph;
    graph.nodes[3] = node("fn:solto", "code", "file:a.py/fn:f");
    expect(() => compactProject({ ...data(), graph })).toThrow(
      /does not carry the id of its file/,
    );
  });
});

/** A project with Python and TypeScript that call each other through a route, a process and a name. */
const MIXED: SourceFile[] = [
  {
    path: "app/cliente.py",
    source: [
      "import requests",
      "import subprocess",
      "from app.modelos.pedido import Pedido",
      "",
      "def pedir_frete(peso):",
      '    return requests.post("http://localhost:3000/api/frete", json={"peso": peso})',
      "",
      "def rodar_ferramenta():",
      '    subprocess.run(["node", "tools/ferramenta.ts"])',
      "",
      "def fechar_conta(itens):",
      "    p = Pedido()",
      "    p.total()",
      "    return somarTotal(itens)",
      "",
    ].join("\n"),
  },
  {
    path: "app/modelos/base.py",
    source: [
      "class Base:",
      "    def salvar(self):",
      "        return True",
      "",
      "def helper():",
      "    return 1",
      "",
    ].join("\n"),
  },
  {
    path: "app/modelos/pedido.py",
    source: [
      "from app.modelos.base import Base, helper",
      "",
      "class Pedido(Base):",
      "    def total(self):",
      "        for i in range(3):",
      "            helper()",
      "        return self.salvar()",
      "",
      "def usar():",
      "    return Pedido().total()",
      "",
      "CONFIG = {'a': 1}",
      "",
    ].join("\n"),
  },
  {
    path: "api/servidor.ts",
    source: [
      'import { Hono } from "hono";',
      'import { calcular } from "./rotas/frete";',
      "",
      "const app = new Hono();",
      "",
      'app.post("/api/frete", (c) => c.json({ valor: calcular(10) }));',
      "",
    ].join("\n"),
  },
  {
    path: "api/rotas/frete.ts",
    source: [
      'import { Base } from "../util";',
      "",
      "export class Frete extends Base {",
      "  valor(): number {",
      "    return this.dobro(2);",
      "  }",
      "}",
      "",
      "export function calcular(peso: number): number {",
      "  return new Frete().valor() + peso;",
      "}",
      "",
    ].join("\n"),
  },
  {
    path: "api/util.ts",
    source: [
      "export class Base {",
      "  dobro(n: number): number {",
      "    return n * 2;",
      "  }",
      "}",
      "",
      "export function ajuda(): number {",
      "  return new Base().dobro(1);",
      "}",
      "",
    ].join("\n"),
  },
  {
    path: "tools/ferramenta.ts",
    source: [
      'import { ajuda } from "../api/util";',
      "",
      "export function limpar(): void {",
      "  ajuda();",
      '  console.log("limpo");',
      "}",
      "",
    ].join("\n"),
  },
  {
    path: "lib.ts",
    source:
      "export function somarTotal(itens: number[]): number {\n  return itens.reduce((a, b) => a + b, 0);\n}\n",
  },
  { path: "vazio.py", source: "" },
];

const mixed = (): ProjectData => ({
  name: "mista",
  graph: linkedGraph(analyzeProject(MIXED, languagePlugins), "mista"),
  files: MIXED,
  ignored: [{ path: "grande.py", reason: "too-large", addable: true }],
  version: "v-mista",
});

describe("the packed store answers like the full graph (mixed Python and TypeScript, with links between languages)", () => {
  const response = mixed();
  const reference = { kind: "ok" as const, root: "/mista", response };
  const index = indexOf(reference);
  const store = storeOf(response);

  it("has the links between languages the comparison needs", () => {
    const links = response.graph.edges.filter((e) => e.id.startsWith("link:"));
    expect(links.map((e) => e.id.split(":")[1])).toEqual(
      expect.arrayContaining(["http", "process", "name"]),
    );
  });

  it("the skeleton: the same JSON", () => {
    expect(store.skeleton).toBe(JSON.stringify(skeletonOf(reference)));
  });

  it("the file: the same detail for every file, with the same refs", () => {
    for (const { path } of MIXED) {
      expect(store.detailOf(path)).toEqual(detailOf(reference, path));
      expect(JSON.stringify(store.detailOf(path))).toBe(
        JSON.stringify(detailOf(reference, path)),
      );
    }
    expect(store.detailOf("nada.py")).toBeUndefined();
    // A call to another file shows where it lands.
    expect(
      Object.values(store.detailOf("app/cliente.py")?.refs ?? {}),
    ).toContain("app/modelos/pedido.py");
  });

  it("the search: the same hits, in the same order, for names, paths, words and limits", () => {
    for (const query of [
      "",
      "  ",
      "pedido",
      "Pedido",
      "pedir frete",
      "frete",
      "calcular()",
      "api",
      "py",
      ".ts",
      "base",
      "helper",
      "nao existe",
    ]) {
      for (const limit of [1, 3, MAX_HITS]) {
        expect(store.search(query, limit)).toEqual(
          searchOf(reference, query, limit),
        );
      }
    }
  });

  it("every node: the same node, file, source, docstrings and calls in both directions", () => {
    for (const n of response.graph.nodes) {
      expect(store.nodeOf(n.id)).toEqual(n);
      expect(store.filePathOf(n.id)).toBe(index.filePathOf(n.id));
      expect(store.callsOf(n.id)).toEqual({
        out: index.callsOut.get(n.id) ?? [],
        in: index.callsIn.get(n.id) ?? [],
      });
    }
    for (const { path, source } of MIXED) {
      expect(store.sourceOf(path)).toBe(source);
      expect(store.docstringsOf(path)).toEqual(
        index.docstrings.get(path) ?? [],
      );
    }
  });

  it("every file of the full graph has a call to another file in the store when it has one", () => {
    const crossing = response.graph.edges.filter(
      (e) =>
        e.kind === "calls" &&
        index.filePathOf(e.source) !== index.filePathOf(e.target),
    );
    expect(crossing.length).toBeGreaterThan(0);
    for (const e of crossing) {
      expect(store.callsOf(e.source).out).toContain(e.target);
      expect(store.callsOf(e.target).in).toContain(e.source);
    }
  });
});
