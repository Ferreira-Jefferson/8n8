import { createRequire } from "node:module";
import type { FlowNode, Graph } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import type { Tree } from "web-tree-sitter";
import {
  innermost,
  markErrorLines,
  markSyntaxErrors,
  treeErrorLines,
} from "../errors";
import { loadParser } from "../parser";

const typescript = createRequire(import.meta.url).resolve(
  "tree-sitter-typescript/tree-sitter-typescript.wasm",
);

async function parse(source: string): Promise<Tree> {
  const tree = (await loadParser(typescript)).parse(source);
  if (!tree) throw new Error("parse failed");
  return tree;
}

function node(id: string, start: number, end: number, parentId?: string) {
  return {
    id,
    kind: id === "mod" ? "module" : "function",
    label: id,
    parentId: parentId ?? null,
    range: { start, end },
    openable: true,
  } as FlowNode;
}

function graphOf(nodes: FlowNode[]): Graph {
  return { nodes, edges: [], empty: nodes.length === 0 } as unknown as Graph;
}

function marks(graph: Graph): [string, number | undefined][] {
  return graph.nodes
    .filter((n) => n.syntaxError !== undefined)
    .map((n) => [n.id, n.syntaxError?.line]);
}

describe("treeErrorLines", () => {
  it("is empty for a clean tree", async () => {
    const tree = await parse("function f() { return 1; }\n");

    expect(treeErrorLines(tree.rootNode)).toEqual([]);
  });

  it("lists the line of an ERROR node", async () => {
    const tree = await parse("const a = 1;\nconst b = ;\nconst c = 3;\n");

    expect(treeErrorLines(tree.rootNode)).toEqual([2]);
  });

  it("lists the line of a MISSING node", async () => {
    const tree = await parse("function f() {\n  return 1;\n");

    expect(treeErrorLines(tree.rootNode)).toEqual([2]);
  });

  it("lists each broken line once, sorted", async () => {
    const tree = await parse("const a = ;\nconst b = 1;\nconst c = ;\n");

    expect(treeErrorLines(tree.rootNode)).toEqual([1, 3]);
  });
});

describe("innermost", () => {
  const nodes = [node("outer", 1, 10), node("inner", 3, 5, "outer")];

  it("picks the smallest node holding the line", () => {
    expect(innermost(nodes, 4)?.id).toBe("inner");
    expect(innermost(nodes, 8)?.id).toBe("outer");
  });

  it("lets the deeper node win a tie in size", () => {
    const tie = [node("a", 2, 4), node("b", 2, 4, "a")];

    expect(innermost(tie, 3)?.id).toBe("b");
  });

  it("is undefined when no node holds the line", () => {
    expect(innermost(nodes, 11)).toBeUndefined();
  });
});

describe("markErrorLines", () => {
  it("returns the same graph when there are no lines", () => {
    const graph = graphOf([node("mod", 1, 5)]);

    expect(markErrorLines(graph, [])).toBe(graph);
  });

  it("marks the innermost node and does not mutate the input", () => {
    const graph = graphOf([node("outer", 1, 10), node("inner", 3, 5, "outer")]);
    const marked = markErrorLines(graph, [4, 8]);

    expect(marks(marked)).toEqual([
      ["outer", 8],
      ["inner", 4],
    ]);
    expect(marks(graph)).toEqual([]);
  });

  it("keeps the first error of a node", () => {
    const graph = graphOf([node("f", 1, 10)]);

    expect(marks(markErrorLines(graph, [3, 6]))).toEqual([["f", 3]]);
  });

  it("creates the module node when no node holds the line", () => {
    const graph = graphOf([node("a", 1, 2), node("b", 8, 9)]);
    const marked = markErrorLines(graph, [5]);

    expect(marked.nodes.map((n) => n.id)).toEqual(["a", "mod", "b"]);
    expect(marks(marked)).toEqual([["mod", 5]]);
    expect(marked.nodes[1]).toMatchObject({
      kind: "module",
      range: { start: 5, end: 5 },
    });
  });

  it("appends the created module and clears `empty` on an empty graph", () => {
    const marked = markErrorLines(graphOf([]), [2]);

    expect(marked.empty).toBe(false);
    expect(marks(marked)).toEqual([["mod", 2]]);
  });

  it("creates the module with a custom id", () => {
    const marked = markErrorLines(graphOf([]), [2], "file:x");

    expect(marked.nodes[0]?.id).toBe("file:x");
  });

  it("reuses an existing module node outside the range", () => {
    const graph = graphOf([node("mod", 1, 2)]);
    const marked = markErrorLines(graph, [9]);

    expect(marked.nodes).toHaveLength(1);
    expect(marks(marked)).toEqual([["mod", 9]]);
  });
});

describe("markSyntaxErrors", () => {
  it("returns the same graph for a clean tree", async () => {
    const graph = graphOf([node("mod", 1, 1)]);

    expect(markSyntaxErrors(await parse("const a = 1;\n"), graph)).toBe(graph);
  });

  it("marks the node that holds the broken line", async () => {
    const graph = graphOf([node("f", 1, 4)]);
    const tree = await parse("function f() {\n  const a = ;\n}\n");

    expect(marks(markSyntaxErrors(tree, graph))).toEqual([["f", 2]]);
  });

  it("passes the module id along", async () => {
    const tree = await parse("const a = ;\n");

    expect(markSyntaxErrors(tree, graphOf([]), "file:y").nodes[0]?.id).toBe(
      "file:y",
    );
  });
});
