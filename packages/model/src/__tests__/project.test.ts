import { describe, expect, it } from "vitest";
import type { FlowNode, Graph } from "../graph";
import { fileNodeOf } from "../project";

function node(
  id: string,
  kind: FlowNode["kind"],
  parentId: string | null,
): FlowNode {
  return {
    id,
    kind,
    label: id,
    parentId,
    range: { start: 1, end: 1 },
    openable: false,
  };
}

const graph: Graph = {
  language: "python",
  empty: false,
  edges: [],
  nodes: [
    node("dir:.", "folder", null),
    node("file:a.py", "file", "dir:."),
    node("file:a.py/fn:f", "function", "file:a.py"),
    node("file:a.py/fn:f/s1", "code", "file:a.py/fn:f"),
  ],
};

describe("fileNodeOf", () => {
  it("returns the file node from a step inside a function", () => {
    expect(fileNodeOf(graph, "file:a.py/fn:f/s1")?.id).toBe("file:a.py");
  });

  it("returns the file node itself", () => {
    expect(fileNodeOf(graph, "file:a.py")?.id).toBe("file:a.py");
  });

  it("returns undefined from a folder node", () => {
    expect(fileNodeOf(graph, "dir:.")).toBeUndefined();
  });

  it("returns undefined for a missing id", () => {
    expect(fileNodeOf(graph, "file:nope.py")).toBeUndefined();
  });

  it("returns undefined in a snippet graph with no file node", () => {
    const snippet: Graph = {
      language: "python",
      empty: false,
      edges: [],
      nodes: [node("fn:f", "function", null), node("fn:f/s1", "code", "fn:f")],
    };
    expect(fileNodeOf(snippet, "fn:f/s1")).toBeUndefined();
  });
});
