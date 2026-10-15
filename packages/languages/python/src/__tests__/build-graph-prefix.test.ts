import type { Graph } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { type BuildOptions, buildGraph } from "../build-graph";
import { loadPythonParser } from "../parse";

const SOURCE = [
  "from b import g",
  "",
  "def f():",
  "    a = 1",
  "    g()",
  "",
  "def h():",
  "    f()",
  "",
  "class C:",
  "    def m(self):",
  "        pass",
  "",
  "x = 1",
  "",
].join("\n");

async function graphOf(options: BuildOptions): Promise<Graph> {
  const parser = await loadPythonParser();
  const tree = parser.parse(SOURCE);
  if (!tree) throw new Error("parse failed");
  return buildGraph(tree, options);
}

describe("buildGraph with a file prefix (AD-013)", () => {
  it("prefixes the ids and hangs the top level under the prefix", async () => {
    const graph = await graphOf({ prefix: "file:a.py" });

    expect(graph.nodes.map((n) => [n.id, n.parentId])).toEqual([
      ["file:a.py/fn:f", "file:a.py"],
      ["file:a.py/fn:f/s0", "file:a.py/fn:f"],
      ["file:a.py/fn:f/s1", "file:a.py/fn:f"],
      ["file:a.py/fn:h", "file:a.py"],
      ["file:a.py/fn:h/s0", "file:a.py/fn:h"],
      ["file:a.py/cls:C", "file:a.py"],
      ["file:a.py/cls:C/fn:m", "file:a.py/cls:C"],
      ["file:a.py/cls:C/fn:m/s0", "file:a.py/cls:C/fn:m"],
      ["file:a.py/mod", "file:a.py"],
      ["file:a.py/mod/s0", "file:a.py/mod"],
    ]);
  });

  it("prefixes the local calls wires", async () => {
    const graph = await graphOf({ prefix: "file:a.py" });

    expect(
      graph.edges.filter((e) => e.kind === "calls").map((e) => e.id),
    ).toEqual(["calls:file:a.py/fn:h->file:a.py/fn:f"]);
  });

  it("turns an import the resolver knows into a call step and a calls wire", async () => {
    const graph = await graphOf({
      prefix: "file:a.py",
      resolveImport: (full) => (full === "b.g" ? "file:b.py/fn:g" : null),
    });

    const step = graph.nodes.find((n) => n.id === "file:a.py/fn:f/s1");
    expect(step).toMatchObject({
      kind: "call",
      label: "g",
      target: "file:b.py/fn:g",
    });
    expect(
      graph.edges.filter((e) => e.kind === "calls").map((e) => e.id),
    ).toEqual([
      "calls:file:a.py/fn:f->file:b.py/fn:g",
      "calls:file:a.py/fn:h->file:a.py/fn:f",
    ]);
  });
});
