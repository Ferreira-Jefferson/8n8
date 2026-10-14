import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { Node } from "web-tree-sitter";
import { lastLine, lineRange } from "../lines";
import { loadParser } from "../parser";

const python = createRequire(import.meta.url).resolve(
  "tree-sitter-python/tree-sitter-python.wasm",
);

async function statements(source: string): Promise<Node[]> {
  const tree = (await loadParser(python)).parse(source);
  if (!tree) throw new Error("parse failed");
  return tree.rootNode.namedChildren;
}

describe("lineRange", () => {
  it("covers the 1-based line of a one-line node", async () => {
    const [, second] = await statements("a = 1\nb = 2\n");

    expect(lineRange(second as Node)).toEqual({ start: 2, end: 2 });
  });

  it("covers every line of a multi-line node", async () => {
    const [def] = await statements("def f():\n  a = 1\n  b = 2\n");

    expect(lineRange(def as Node)).toEqual({ start: 1, end: 3 });
  });

  it("does not count the next line when a node ends at column 0", async () => {
    const tree = (await loadParser(python)).parse("a = 1\nb = 2\n");
    const root = tree?.rootNode as Node;

    expect(root.endPosition).toMatchObject({ row: 2, column: 0 });
    expect(lineRange(root)).toEqual({ start: 1, end: 2 });
  });
});

describe("lastLine", () => {
  it("counts the lines of a text", () => {
    expect(lastLine("a\nb\nc")).toBe(3);
  });

  it("ignores one trailing newline", () => {
    expect(lastLine("a\nb\n")).toBe(2);
  });

  it("is 1 for an empty text", () => {
    expect(lastLine("")).toBe(1);
    expect(lastLine("\n")).toBe(1);
  });
});
