import type { SourceFile } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { analyzeProject, buildProject } from "../build";
import { fakePlugin } from "./fake-plugin";

const STRUCTURE = new Set(["folder", "file"]);

const LOJA: SourceFile[] = [
  { path: "frete/__init__.py", source: "" },
  { path: "frete/calculo.py", source: "def calcular\n\n\n" },
  { path: "legado/frete_antigo.py", source: "def calcular\n" },
  { path: "main.py", source: "def main\nuse pedidos/pedidos.py\n" },
  { path: "pedidos/__init__.py", source: "" },
  {
    path: "pedidos/pedidos.py",
    source: "def processar\nuse frete/calculo.py\n",
  },
  { path: "relatorio.py", source: "def gerar\n" },
];

const py = fakePlugin("python", [".py"]);

describe("buildProject: folders and files (PROJ-02)", () => {
  it("lays out folder and file nodes in pre-order, folders before the files of the root", () => {
    const graph = buildProject(LOJA, [py]);

    expect(
      graph.nodes
        .filter((n) => STRUCTURE.has(n.kind))
        .map((n) => [n.id, n.kind, n.label, n.path, n.parentId]),
    ).toEqual([
      ["dir:frete", "folder", "frete", "frete", null],
      [
        "file:frete/__init__.py",
        "file",
        "__init__.py",
        "frete/__init__.py",
        "dir:frete",
      ],
      [
        "file:frete/calculo.py",
        "file",
        "calculo.py",
        "frete/calculo.py",
        "dir:frete",
      ],
      ["dir:legado", "folder", "legado", "legado", null],
      [
        "file:legado/frete_antigo.py",
        "file",
        "frete_antigo.py",
        "legado/frete_antigo.py",
        "dir:legado",
      ],
      ["dir:pedidos", "folder", "pedidos", "pedidos", null],
      [
        "file:pedidos/__init__.py",
        "file",
        "__init__.py",
        "pedidos/__init__.py",
        "dir:pedidos",
      ],
      [
        "file:pedidos/pedidos.py",
        "file",
        "pedidos.py",
        "pedidos/pedidos.py",
        "dir:pedidos",
      ],
      ["file:main.py", "file", "main.py", "main.py", null],
      ["file:relatorio.py", "file", "relatorio.py", "relatorio.py", null],
    ]);
  });

  it("nests folders and follows each file node with its inner nodes", () => {
    const graph = buildProject(
      [
        { path: "a/b/c.py", source: "def f\n" },
        { path: "a/d.py", source: "def g\n" },
      ],
      [py],
    );

    expect(graph.nodes.map((n) => [n.id, n.parentId])).toEqual([
      ["dir:a", null],
      ["dir:a/b", "dir:a"],
      ["file:a/b/c.py", "dir:a/b"],
      ["file:a/b/c.py/fn:f", "file:a/b/c.py"],
      ["file:a/d.py", "dir:a"],
      ["file:a/d.py/fn:g", "file:a/d.py"],
    ]);
  });

  it("spans a file node over all its lines and a folder node over {1, 1}", () => {
    const graph = buildProject(LOJA, [py]);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));

    expect(byId.get("file:frete/calculo.py")?.range).toEqual({
      start: 1,
      end: 3,
    });
    expect(byId.get("dir:frete")?.range).toEqual({ start: 1, end: 1 });
  });

  it("leaves out the root node when no file sits at the root", () => {
    const graph = buildProject([{ path: "a/b.py", source: "def f\n" }], [py]);

    expect(
      graph.nodes.filter((n) => STRUCTURE.has(n.kind)).map((n) => n.id),
    ).toEqual(["dir:a", "file:a/b.py"]);
  });

  it("gives the same graph on two runs and with the files reversed", () => {
    const first = buildProject(LOJA, [py]);

    expect(buildProject(LOJA, [py])).toEqual(first);
    expect(buildProject([...LOJA].reverse(), [py])).toEqual(first);
  });

  it("gives an empty graph for no files, with the only plugin's language", () => {
    expect(buildProject([], [py])).toEqual({
      language: "python",
      empty: true,
      nodes: [],
      edges: [],
    });
  });

  it("throws on a node id repeated between files, even of different plugins", () => {
    const clash = fakePlugin("python", [".py"], {
      tweak: (analysis) => ({
        ...analysis,
        files: analysis.files.map((f) => ({
          ...f,
          graph: {
            ...f.graph,
            nodes: [
              ...f.graph.nodes,
              {
                id: "file:b.ts",
                kind: "code" as const,
                label: "x",
                parentId: f.graph.nodes[0]?.id ?? null,
                range: { start: 1, end: 1 },
                openable: false,
              },
            ],
          },
        })),
      }),
    });

    expect(() =>
      buildProject(
        [
          { path: "a.py", source: "x\n" },
          { path: "b.ts", source: "x\n" },
        ],
        [clash, fakePlugin("typescript", [".ts"])],
      ),
    ).toThrow(/duplicate node id: file:b\.ts/);
  });
});

describe("buildProject: imports wires (PROJ-03)", () => {
  it("wires the imports the plugin reports, after the wires inside the files", () => {
    const graph = buildProject(LOJA, [py]);

    expect(graph.edges.map((e) => e.id)).toEqual([
      "imports:file:main.py->file:pedidos/pedidos.py",
      "imports:file:pedidos/pedidos.py->file:frete/calculo.py",
    ]);
    expect(graph.edges[0]).toEqual({
      id: "imports:file:main.py->file:pedidos/pedidos.py",
      kind: "imports",
      source: "file:main.py",
      target: "file:pedidos/pedidos.py",
    });
  });

  it("keeps the wires of each file and repeats no imports wire", () => {
    const wire = {
      id: "imports:file:a.py->file:b.py",
      kind: "imports" as const,
      source: "file:a.py",
      target: "file:b.py",
    };
    const calls = {
      id: "calls:file:a.py/fn:f->file:b.py/fn:g",
      kind: "calls" as const,
      source: "file:a.py/fn:f",
      target: "file:b.py/fn:g",
    };
    const plugin = fakePlugin("python", [".py"], {
      tweak: (analysis) => ({
        ...analysis,
        files: analysis.files.map((f) =>
          f.path === "a.py"
            ? { ...f, graph: { ...f.graph, edges: [calls] } }
            : f,
        ),
        imports: [wire, wire],
      }),
    });

    const graph = buildProject(
      [
        { path: "a.py", source: "def f\n" },
        { path: "b.py", source: "def g\n" },
      ],
      [plugin],
    );

    expect(graph.edges).toEqual([calls, wire]);
  });
});

describe("buildProject: choosing the plugin", () => {
  const ts = fakePlugin("typescript", [".ts", ".tsx"]);
  const files: SourceFile[] = [
    { path: "a.py", source: "def f\n" },
    { path: "web/b.ts", source: "def g\n" },
  ];

  it("gives each plugin only the files of its extensions, in code order", () => {
    const pyCalls: SourceFile[][] = [];
    const tsCalls: SourceFile[][] = [];
    buildProject(
      [
        { path: "z.py", source: "" },
        { path: "a.py", source: "" },
        { path: "c.tsx", source: "" },
        { path: "b.ts", source: "" },
      ],
      [
        fakePlugin("python", [".py"], { calls: pyCalls }),
        fakePlugin("typescript", [".ts", ".tsx"], { calls: tsCalls }),
      ],
    );

    expect(pyCalls.map((c) => c.map((f) => f.path))).toEqual([
      ["a.py", "z.py"],
    ]);
    expect(tsCalls.map((c) => c.map((f) => f.path))).toEqual([
      ["b.ts", "c.tsx"],
    ]);
  });

  it("gives a plugin its manifests among its files, in path order, and only when it has files", () => {
    const tsCalls: SourceFile[][] = [];
    const reader = {
      ...fakePlugin("typescript", [".ts"], {
        calls: tsCalls,
        // A manifest gives no graph.
        tweak: (analysis) => ({
          ...analysis,
          files: analysis.files.filter((f) => !f.path.endsWith("m.json")),
        }),
      }),
      manifests: ["m.json"],
    };
    const graph = buildProject(
      [
        { path: "z.py", source: "" },
        { path: "web/m.json", source: "{}" },
        { path: "web/b.ts", source: "" },
        { path: "a/m.json", source: "{}" },
      ],
      [fakePlugin("python", [".py"]), reader],
    );

    expect(tsCalls.map((c) => c.map((f) => f.path))).toEqual([
      ["a/m.json", "web/b.ts", "web/m.json"],
    ]);
    expect(graph.nodes.some((n) => n.id.endsWith("m.json"))).toBe(false);

    const pyOnly = buildProject(
      [
        { path: "z.py", source: "" },
        { path: "m.json", source: "{}" },
      ],
      [fakePlugin("python", [".py"]), reader],
    );
    expect(pyOnly.language).toBe("python");
  });

  it("matches the extension without regard to case", () => {
    const graph = buildProject(
      [{ path: "LOJA/MAIN.PY", source: "def f\n" }],
      [py],
    );

    expect(graph.nodes.map((n) => n.id)).toEqual([
      "dir:LOJA",
      "file:LOJA/MAIN.PY",
      "file:LOJA/MAIN.PY/fn:f",
    ]);
  });

  it("uses the language of the plugin when only one has files", () => {
    expect(buildProject([files[0] as SourceFile], [py, ts]).language).toBe(
      "python",
    );
    expect(buildProject([files[1] as SourceFile], [py, ts]).language).toBe(
      "typescript",
    );
  });

  it("gives `mixed` when more than one language has files, with both in one graph", () => {
    const graph = buildProject(files, [py, ts]);

    expect(graph.language).toBe("mixed");
    expect(graph.nodes.map((n) => n.id)).toEqual([
      "dir:web",
      "file:web/b.ts",
      "file:web/b.ts/fn:g",
      "file:a.py",
      "file:a.py/fn:f",
    ]);
  });

  it("ignores a file that no plugin serves, or that has no extension", () => {
    const graph = buildProject(
      [
        { path: "notas.txt", source: "oi" },
        { path: "Makefile", source: "all:" },
        { path: "a.py", source: "def f\n" },
      ],
      [py],
    );

    expect(graph.nodes.map((n) => n.id)).toEqual([
      "file:a.py",
      "file:a.py/fn:f",
    ]);
  });

  it("gives an empty graph when no plugin serves any file", () => {
    expect(buildProject([{ path: "notas.txt", source: "oi" }], [py])).toEqual({
      language: "python",
      empty: true,
      nodes: [],
      edges: [],
    });
  });

  it("gives `mixed` and an empty graph with no files and several plugins, or none", () => {
    expect(buildProject([], [py, ts])).toMatchObject({
      language: "mixed",
      empty: true,
    });
    expect(buildProject([{ path: "a.py", source: "" }], [])).toMatchObject({
      language: "mixed",
      empty: true,
    });
  });

  it("gives the file to the first plugin that serves its extension", () => {
    const first = fakePlugin("first", [".py"]);
    const second = fakePlugin("second", [".py"]);

    expect(
      buildProject([{ path: "a.py", source: "" }], [first, second]).language,
    ).toBe("first");
  });
});

describe("buildProject: a file that fails alone (2.3)", () => {
  const boom = (files: SourceFile[]) =>
    files.some((f) => f.source.includes("BOOM"));
  const plugin = fakePlugin("python", [".py"], { throwsOn: boom });

  it("turns the failed file into a file node with a syntax error, and maps the rest", () => {
    const graph = buildProject(
      [
        { path: "ok.py", source: "def f\n" },
        { path: "dir/ruim.py", source: "BOOM\nsegunda\n" },
        { path: "outro.py", source: "def g\nuse ok.py\n" },
      ],
      [plugin],
    );

    expect(
      graph.nodes.map((n) => [n.id, n.kind, n.syntaxError ?? null]),
    ).toEqual([
      ["dir:dir", "folder", null],
      ["file:dir/ruim.py", "file", { line: 1 }],
      ["file:ok.py", "file", null],
      ["file:ok.py/fn:f", "function", null],
      ["file:outro.py", "file", null],
      ["file:outro.py/fn:g", "function", null],
    ]);
    expect(graph.nodes[1]).toEqual({
      id: "file:dir/ruim.py",
      kind: "file",
      label: "ruim.py",
      parentId: "dir:dir",
      range: { start: 1, end: 2 },
      openable: true,
      path: "dir/ruim.py",
      syntaxError: { line: 1 },
    });
    expect(graph.edges.map((e) => e.id)).toEqual([
      "imports:file:outro.py->file:ok.py",
    ]);
    expect(graph.language).toBe("python");
  });

  it("puts a failed file in the root at the top, with no parent", () => {
    const graph = buildProject([{ path: "ruim.py", source: "BOOM" }], [plugin]);

    expect(graph.nodes).toMatchObject([
      { id: "file:ruim.py", parentId: null, syntaxError: { line: 1 } },
    ]);
    expect(graph.empty).toBe(false);
  });

  it("fails with the plugin's name when no single file explains the error", () => {
    const always = fakePlugin("python", [".py"], { throwsOn: () => true });
    // Every single file throws too: all of them fail, none is left to analyze.
    expect(
      buildProject([{ path: "a.py", source: "" }], [always]).nodes,
    ).toHaveLength(1);

    const together = fakePlugin("python", [".py"], {
      throwsOn: (files) => files.length > 1,
    });
    expect(() =>
      buildProject(
        [
          { path: "a.py", source: "" },
          { path: "b.py", source: "" },
        ],
        [together],
      ),
    ).toThrow(/plugin "python" failed to analyze: parser exploded/);
  });

  it("fails with the plugin's name when the rest still throws together", () => {
    const flaky = fakePlugin("python", [".py"], {
      throwsOn: (files) => boom(files) || files.length === 2,
    });

    expect(() =>
      buildProject(
        [
          { path: "a.py", source: "" },
          { path: "b.py", source: "" },
          { path: "c.py", source: "BOOM" },
        ],
        [flaky],
      ),
    ).toThrow(/plugin "python" failed to analyze: parser exploded/);
  });

  it("explains a thrown value that is not an Error", () => {
    const odd = fakePlugin("python", [".py"], {
      throwsOn: (files) => files.length > 1,
    });
    const original = odd.analyze;
    odd.analyze = (files) => {
      if (files.length > 1) throw "texto solto";
      return original(files);
    };

    expect(() =>
      buildProject(
        [
          { path: "a.py", source: "" },
          { path: "b.py", source: "" },
        ],
        [odd],
      ),
    ).toThrow(/failed to analyze: texto solto/);
  });
});

describe("analyzeProject: offers and requests", () => {
  it("returns them as the plugins reported, in plugin order, without matching", () => {
    const offer = (key: string, nodeId: string) => ({
      channel: "http" as const,
      key,
      nodeId,
      line: 1,
    });
    const request = (key: string, nodeId: string) => ({
      channel: "name" as const,
      key,
      nodeId,
      line: 1,
    });
    const withLinks = (id: string, path: string) =>
      fakePlugin(id, [path.slice(path.lastIndexOf("."))], {
        tweak: (analysis) => ({
          ...analysis,
          offers: [offer(`GET /${id}`, `file:${path}`)],
          requests: [request(id, `file:${path}`)],
        }),
      });

    const { graph, offers, requests } = analyzeProject(
      [
        { path: "b.ts", source: "" },
        { path: "a.py", source: "" },
      ],
      [withLinks("python", "a.py"), withLinks("typescript", "b.ts")],
    );

    expect(offers.map((o) => o.key)).toEqual([
      "GET /python",
      "GET /typescript",
    ]);
    expect(requests.map((r) => r.key)).toEqual(["python", "typescript"]);
    expect(graph.edges).toEqual([]);
  });

  it("returns none for no files", () => {
    expect(analyzeProject([], [py])).toEqual({
      graph: { language: "python", empty: true, nodes: [], edges: [] },
      offers: [],
      requests: [],
    });
  });
});
