import type {
  FlowNode,
  Graph,
  LanguageAnalysis,
  SourceFile,
} from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { analysisProblems, graphProblems, lineCount } from "../check";

function node(id: string, extra: Partial<FlowNode> = {}): FlowNode {
  return {
    id,
    kind: "function",
    label: id,
    parentId: null,
    range: { start: 1, end: 2 },
    openable: true,
    ...extra,
  };
}

function graph(nodes: FlowNode[], language = "x"): Graph {
  return { language, empty: nodes.length === 0, nodes, edges: [] };
}

const SOURCE = "a\nb\nc\n";

describe("lineCount", () => {
  it("does not count the empty line after a final newline", () => {
    expect(lineCount("a\nb\n")).toBe(2);
    expect(lineCount("a\nb")).toBe(2);
  });

  it("is at least 1", () => {
    expect(lineCount("")).toBe(1);
  });
});

describe("graphProblems", () => {
  it("accepts a graph in pre-order with correct lines", () => {
    const g = graph([
      node("fn:a"),
      node("fn:a/s1", { kind: "code", parentId: "fn:a", openable: false }),
      node("fn:a/s2", { kind: "code", parentId: "fn:a", openable: false }),
      node("fn:b", { range: { start: 3, end: 3 } }),
    ]);

    expect(graphProblems(g, SOURCE)).toEqual([]);
  });

  it("accepts a call with a target, openable, and an empty graph", () => {
    expect(
      graphProblems(
        graph([node("c", { kind: "call", target: "fn:a", openable: true })]),
        SOURCE,
      ),
    ).toEqual([]);
    expect(graphProblems(graph([]), "")).toEqual([]);
  });

  it("finds a repeated id", () => {
    expect(graphProblems(graph([node("a"), node("a")]), SOURCE)).toContain(
      "duplicate node id a",
    );
  });

  it("finds a parent that comes after its child", () => {
    const g = graph([node("b", { parentId: "a" }), node("a")]);

    expect(graphProblems(g, SOURCE)).toContain("node b is not in pre-order");
  });

  it("finds a child that comes after its parent's subtree has closed", () => {
    const g = graph([
      node("a"),
      node("b"),
      node("a/late", { parentId: "a" }),
    ]);

    expect(graphProblems(g, SOURCE)).toEqual([
      "node a/late is not in pre-order",
    ]);
  });

  it("finds lines that are not 1-based or not whole numbers", () => {
    expect(
      graphProblems(graph([node("a", { range: { start: 0, end: 1 } })]), SOURCE),
    ).toContain("node a has lines 0-1, not 1-based");
    expect(
      graphProblems(
        graph([node("a", { range: { start: 1.5, end: 2 } })]),
        SOURCE,
      ),
    ).toContain("node a has lines 1.5-2, not 1-based");
    expect(
      graphProblems(
        graph([node("a", { range: { start: 1, end: 1.5 } })]),
        SOURCE,
      ),
    ).toContain("node a has lines 1-1.5, not 1-based");
  });

  it("finds lines that end before they start or past the source", () => {
    expect(
      graphProblems(graph([node("a", { range: { start: 3, end: 2 } })]), SOURCE),
    ).toContain("node a has lines 3-2, outside 1-3");
    expect(
      graphProblems(graph([node("a", { range: { start: 1, end: 4 } })]), SOURCE),
    ).toContain("node a has lines 1-4, outside 1-3");
  });

  it("finds a breach of the openable rule", () => {
    const wrong = (kind: FlowNode["kind"], extra: Partial<FlowNode>) =>
      graphProblems(graph([node("a", { kind, ...extra })]), SOURCE);

    expect(wrong("code", { openable: true })).toEqual([
      "node a (code) has openable true",
    ]);
    expect(wrong("condition", { openable: true })).toHaveLength(1);
    expect(wrong("external", { openable: true })).toHaveLength(1);
    expect(wrong("return", { openable: true })).toHaveLength(1);
    expect(wrong("function", { openable: false })).toHaveLength(1);
    expect(wrong("call", { openable: true })).toHaveLength(1);
    expect(wrong("call", { target: "x", openable: false })).toHaveLength(1);
  });
});

const FILES: SourceFile[] = [
  { path: "a.x", source: "a\nb\n" },
  { path: "b/c.x", source: "c\n" },
];

function analysis(extra: Partial<LanguageAnalysis> = {}): LanguageAnalysis {
  return {
    files: [
      {
        path: "a.x",
        graph: graph([
          node("file:a.x", { kind: "file", range: { start: 1, end: 2 } }),
          node("file:a.x/fn:f", { parentId: "file:a.x" }),
        ]),
      },
      {
        path: "b/c.x",
        graph: graph([
          node("file:b/c.x", {
            kind: "file",
            parentId: "dir:b",
            range: { start: 1, end: 1 },
          }),
        ]),
      },
    ],
    imports: [],
    offers: [],
    requests: [],
    ...extra,
  };
}

describe("analysisProblems", () => {
  it("accepts a conforming analysis", () => {
    expect(analysisProblems(FILES, analysis(), "x")).toEqual([]);
  });

  it("accepts wires, offers and requests that point to nodes of the analysis", () => {
    const ok = analysis({
      imports: [
        {
          id: "i",
          kind: "imports",
          source: "file:a.x",
          target: "file:b/c.x",
        },
      ],
      offers: [
        { channel: "name", key: "f", nodeId: "file:a.x/fn:f", line: 1 },
      ],
      requests: [{ channel: "name", key: "g", nodeId: "file:a.x", line: 2 }],
    });

    expect(analysisProblems(FILES, ok, "x")).toEqual([]);
  });

  it("finds a file that was not given, and a file with no graph", () => {
    const extra = analysis();
    const [first] = extra.files;
    const problems = analysisProblems(
      FILES,
      {
        ...extra,
        files: [
          ...(first ? [{ ...first, path: "z.x" }] : []),
          ...extra.files.slice(1),
        ],
      },
      "x",
    );

    expect(problems).toContain("z.x: a file that was not given");
    expect(problems).toContain("a.x: no graph returned");
  });

  it("finds a first node that is not the file node, and ids outside the prefix", () => {
    const bad = analysis({
      files: [
        {
          path: "a.x",
          graph: graph([
            node("fn:f"),
            node("file:a.xy", { range: { start: 1, end: 1 } }),
          ]),
        },
        ...analysis().files.slice(1),
      ],
    });
    const problems = analysisProblems(FILES, bad, "x");

    expect(problems).toContain(
      "a.x: the first node must be the file node file:a.x",
    );
    expect(problems).toContain("a.x: node fn:f does not start with file:a.x");
    expect(problems).toContain(
      "a.x: node file:a.xy does not start with file:a.x",
    );
  });

  it("finds a first node of the right id but another kind", () => {
    const bad = analysis({
      files: [
        { path: "a.x", graph: graph([node("file:a.x")]) },
        ...analysis().files.slice(1),
      ],
    });

    expect(analysisProblems(FILES, bad, "x")).toContain(
      "a.x: the first node must be the file node file:a.x",
    );
  });

  it("finds an empty graph, a wrong language and the graph problems with the path", () => {
    const bad = analysis({
      files: [
        { path: "a.x", graph: graph([], "other") },
        {
          path: "b/c.x",
          graph: graph([
            node("file:b/c.x", { kind: "file", range: { start: 1, end: 9 } }),
          ]),
        },
      ],
    });
    const problems = analysisProblems(FILES, bad, "x");

    expect(problems).toContain(
      "a.x: the first node must be the file node file:a.x",
    );
    expect(problems).toContain("a.x: graph language is other");
    expect(problems).toContain(
      "b/c.x: node file:b/c.x has lines 1-9, outside 1-1",
    );
  });

  it("finds wires, imports, offers and requests that point nowhere", () => {
    const base = analysis();
    const [first, second] = base.files;
    const wire = {
      id: "e",
      kind: "calls" as const,
      source: "file:a.x",
      target: "nada",
    };
    const bad: LanguageAnalysis = {
      files: [
        first
          ? { ...first, graph: { ...first.graph, edges: [wire] } }
          : { path: "", graph: graph([]) },
        ...(second ? [second] : []),
      ],
      imports: [
        { id: "i1", kind: "imports", source: "x", target: "file:a.x" },
        { id: "i2", kind: "calls", source: "file:a.x", target: "file:b/c.x" },
      ],
      offers: [{ channel: "http", key: "GET /", nodeId: "nada", line: 1 }],
      requests: [{ channel: "name", key: "g", nodeId: "file:a.x", line: 0 }],
    };

    expect(analysisProblems(FILES, bad, "x")).toEqual([
      "edge e: nada not found",
      "edge i1: x not found",
      "edge i2: kind calls among the imports",
      "http GET /: nada not found",
      "name g: line 0",
    ]);
  });

  it("finds a line that is not a whole number", () => {
    const bad = analysis({
      requests: [{ channel: "name", key: "g", nodeId: "file:a.x", line: 1.5 }],
    });

    expect(analysisProblems(FILES, bad, "x")).toEqual(["name g: line 1.5"]);
  });
});
