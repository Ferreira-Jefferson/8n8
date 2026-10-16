import type { FlowEdge, FlowNode } from "@8n8/model";
import { describe, expect, it } from "vitest";
import type { ProjectRead } from "../project-index";
import { indexOf } from "../project-index";

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

const read = (): Extract<ProjectRead, { kind: "ok" }> => ({
  kind: "ok",
  root: "/p",
  response: {
    name: "p",
    ignored: [],
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
  },
});

describe("indexOf", () => {
  it("finds the file of a node at any depth, and none for a folder", () => {
    const index = indexOf(read());
    expect(index.filePathOf("file:a.py/fn:f/s1")).toBe("a.py");
    expect(index.filePathOf("file:b.py")).toBe("b.py");
    expect(index.filePathOf("dir:.")).toBe("");
    expect(index.filePathOf("missing")).toBe("");
  });

  it("keeps the source and the docstrings of each file", () => {
    const index = indexOf(read());
    expect(index.sources.get("b.py")).toBe("def g():\n  pass\n");
    expect(index.docstrings.get("a.py")).toEqual([{ start: 2, end: 2 }]);
    expect(index.docstrings.get("b.py")).toBeUndefined();
  });

  it("keeps the calls in both directions and ignores other edges", () => {
    const index = indexOf(read());
    expect(index.callsOut.get("file:a.py/fn:f")).toEqual(["file:b.py/fn:g"]);
    expect(index.callsIn.get("file:b.py/fn:g")).toEqual(["file:a.py/fn:f"]);
    expect(index.callsOut.get("file:a.py")).toBeUndefined();
  });

  it("is made once for the same read", () => {
    const one = read();
    expect(indexOf(one)).toBe(indexOf(one));
    expect(indexOf(read())).not.toBe(indexOf(one));
  });
});
