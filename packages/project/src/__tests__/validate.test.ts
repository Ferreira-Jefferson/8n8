import type { FlowNode, Graph, LanguageAnalysis, SourceFile } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { buildProject } from "../build";
import { fakePlugin } from "./fake-plugin";

const FILES: SourceFile[] = [
  { path: "pkg/a.py", source: "def f\nx\ny\n" },
  { path: "b.py", source: "def g\n" },
];

type Tweak = (analysis: LanguageAnalysis) => LanguageAnalysis;

/** Builds the project with a plugin whose `analyze` result is changed by `tweak`. */
function build(tweak: Tweak, files: SourceFile[] = FILES): Graph {
  return buildProject(files, [fakePlugin("bugado", [".py"], { tweak })]);
}

function onFile(path: string, change: (graph: Graph) => Graph): Tweak {
  return (analysis) => ({
    ...analysis,
    files: analysis.files.map((f) =>
      f.path === path ? { ...f, graph: change(f.graph) } : f,
    ),
  });
}

function mapNode(
  path: string,
  id: string,
  change: (node: FlowNode) => FlowNode,
): Tweak {
  return onFile(path, (graph) => ({
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === id ? change(n) : n)),
  }));
}

describe("validation of what a plugin returns (2.4)", () => {
  it("accepts a correct analysis", () => {
    expect(() => build((a) => a)).not.toThrow();
  });

  it("names the plugin and the file in every error", () => {
    expect(() =>
      build(
        mapNode("b.py", "file:b.py/fn:g", (n) => ({ ...n, parentId: "x" })),
      ),
    ).toThrow(/^plugin "bugado" returned an invalid analysis for b\.py: /);
  });

  it("rejects a file the plugin was not given", () => {
    expect(() =>
      build((a) => ({
        ...a,
        files: [
          ...a.files,
          { path: "c.py", graph: { ...a.files[0]?.graph } as Graph },
        ],
      })),
    ).toThrow(/for c\.py: a file it was not given/);
  });

  it("rejects a file returned twice", () => {
    expect(() =>
      build((a) => ({ ...a, files: [...a.files, ...a.files] })),
    ).toThrow(
      /for b\.py: the file appears twice|for pkg\/a\.py: the file appears twice/,
    );
  });

  it("rejects a missing graph for a file", () => {
    expect(() => build((a) => ({ ...a, files: a.files.slice(1) }))).toThrow(
      /for b\.py: no graph for this file/,
    );
  });

  it("rejects a graph with no nodes", () => {
    expect(() => build(onFile("b.py", (g) => ({ ...g, nodes: [] })))).toThrow(
      /for b\.py: the first node must be the file node file:b\.py/,
    );
  });

  it("rejects a first node that is not the file node", () => {
    expect(() =>
      build(mapNode("b.py", "file:b.py", (n) => ({ ...n, kind: "module" }))),
    ).toThrow(/the first node must be the file node file:b\.py/);
    expect(() =>
      build(mapNode("b.py", "file:b.py", (n) => ({ ...n, id: "file:outro" }))),
    ).toThrow(/the first node must be the file node file:b\.py/);
  });

  it("rejects a file node with the wrong parent", () => {
    expect(() =>
      build(mapNode("b.py", "file:b.py", (n) => ({ ...n, parentId: "dir:x" }))),
    ).toThrow(/for b\.py: the file node must have the parent null/);
    expect(() =>
      build(
        mapNode("pkg/a.py", "file:pkg/a.py", (n) => ({ ...n, parentId: null })),
      ),
    ).toThrow(/for pkg\/a\.py: the file node must have the parent dir:pkg/);
  });

  it("rejects a repeated node id", () => {
    expect(() =>
      build(
        onFile("b.py", (g) => ({
          ...g,
          nodes: [...g.nodes, ...g.nodes.slice(1)],
        })),
      ),
    ).toThrow(/for b\.py: duplicate node id file:b\.py\/fn:g/);
  });

  it("rejects a parent that does not exist", () => {
    expect(() =>
      build(
        mapNode("b.py", "file:b.py/fn:g", (n) => ({
          ...n,
          parentId: "fn:nada",
        })),
      ),
    ).toThrow(
      /for b\.py: node file:b\.py\/fn:g has a parent that does not exist/,
    );
    expect(() =>
      build(
        mapNode("b.py", "file:b.py/fn:g", (n) => ({ ...n, parentId: null })),
      ),
    ).toThrow(/has a parent that does not exist/);
  });

  it("rejects lines outside the file", () => {
    const range = (start: number, end: number) =>
      mapNode("b.py", "file:b.py/fn:g", (n) => ({
        ...n,
        range: { start, end },
      }));

    expect(() => build(range(0, 1))).toThrow(
      /node file:b\.py\/fn:g has the lines 0-1, outside 1-1/,
    );
    expect(() => build(range(1, 2))).toThrow(/the lines 1-2, outside 1-1/);
    expect(() => build(range(2, 1))).toThrow(/the lines 2-1, outside 1-1/);
    expect(() => build(range(1, 1))).not.toThrow();
  });

  it("rejects a syntax error outside the file", () => {
    const at = (line: number) =>
      mapNode("b.py", "file:b.py/fn:g", (n) => ({
        ...n,
        syntaxError: { line },
      }));

    expect(() => build(at(0))).toThrow(/a syntax error on line 0/);
    expect(() => build(at(2))).toThrow(/a syntax error on line 2/);
    expect(() => build(at(1))).not.toThrow();
  });

  it("rejects a wire inside a file whose end does not exist", () => {
    const wire = (source: string, target: string) =>
      onFile("b.py", (g) => ({
        ...g,
        edges: [{ id: "calls:x", kind: "calls", source, target }],
      }));

    expect(() => build(wire("file:b.py/fn:g", "file:nada"))).toThrow(
      /for b\.py: edge calls:x points to file:nada, which does not exist/,
    );
    expect(() => build(wire("file:nada", "file:b.py/fn:g"))).toThrow(
      /edge calls:x points to file:nada/,
    );
  });

  it("accepts a wire to a node of another file of the same plugin", () => {
    expect(() =>
      build(
        onFile("b.py", (g) => ({
          ...g,
          edges: [
            {
              id: "calls:x",
              kind: "calls",
              source: "file:b.py/fn:g",
              target: "file:pkg/a.py/fn:f",
            },
          ],
        })),
      ),
    ).not.toThrow();
  });

  it("rejects an imports wire whose end does not exist", () => {
    expect(() =>
      build((a) => ({
        ...a,
        imports: [
          {
            id: "imports:x",
            kind: "imports",
            source: "file:b.py",
            target: "file:nada.py",
          },
        ],
      })),
    ).toThrow(/for imports: edge imports:x points to file:nada\.py/);
  });

  it("rejects an offer or a request that points to a node that does not exist", () => {
    const link = { channel: "http" as const, key: "GET /x", line: 1 };

    expect(() =>
      build((a) => ({ ...a, offers: [{ ...link, nodeId: "fn:nada" }] })),
    ).toThrow(/for http: GET \/x points to fn:nada, which does not exist/);
    expect(() =>
      build((a) => ({ ...a, requests: [{ ...link, nodeId: "fn:nada" }] })),
    ).toThrow(/for http: GET \/x points to fn:nada/);
    expect(() =>
      build((a) => ({ ...a, offers: [{ ...link, nodeId: "file:b.py" }] })),
    ).not.toThrow();
  });
});
