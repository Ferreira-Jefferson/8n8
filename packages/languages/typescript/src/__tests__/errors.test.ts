import { describe, expect, it } from "vitest";
import { extract, node } from "./helpers";

describe("syntax errors", () => {
  it("marks no node in a clean text", () => {
    expect(
      extract("function f() { return 1; }\n").nodes.some((n) => n.syntaxError),
    ).toBe(false);
  });

  it("marks the step that holds the broken line", () => {
    const graph = extract(
      "function f() {\n  const a = 1;\n  const b = ;\n  return a;\n}\n",
    );

    expect(graph.nodes.filter((n) => n.syntaxError)).toEqual([
      expect.objectContaining({
        id: "fn:f/s0",
        range: { start: 2, end: 3 },
        syntaxError: { line: 3 },
      }),
    ]);
  });

  it("marks the function when the break is in its signature", () => {
    const graph = extract(
      "function f(a b) {\n  return a;\n}\nfunction g() {}\n",
    );

    expect(node(graph, "fn:f").syntaxError).toEqual({ line: 1 });
    expect(node(graph, "fn:g").syntaxError).toBeUndefined();
  });

  it("creates the module node for a break outside any node, at the broken line", () => {
    const graph = extract("function f() {}\n)\nfunction g() {}\n");

    expect(node(graph, "mod")).toMatchObject({
      kind: "module",
      openable: true,
      range: { start: 2, end: 2 },
      syntaxError: { line: 2 },
    });
    expect(graph.nodes.map((n) => n.id)).toEqual(["fn:f", "mod", "fn:g"]);
    expect(graph.empty).toBe(false);
  });

  it("makes a graph of a text that is only an error", () => {
    const graph = extract(")\n");

    expect(graph.nodes.map((n) => n.id)).toEqual(["mod"]);
    expect(graph.empty).toBe(false);
  });

  it("keeps the first error line of a node that has several", () => {
    const graph = extract("function f() {\n  const a = ;\n  const b = ;\n}\n");

    expect(node(graph, "fn:f/s0").syntaxError).toEqual({ line: 2 });
    expect(node(graph, "fn:f").syntaxError).toBeUndefined();
  });

  it("reads JSX as TSX instead of reporting an error", () => {
    const graph = extract(
      "export function Tela() {\n  return <div>oi</div>;\n}\n",
    );

    expect(graph.nodes.some((n) => n.syntaxError)).toBe(false);
    expect(node(graph, "fn:Tela/s0").kind).toBe("return");
  });

  it("still reports an error when TSX does not read it clean either", () => {
    const graph = extract(
      "export function Tela() {\n  const a = ;\n  return <div/>;\n}\n",
    );

    expect(graph.nodes.some((n) => n.syntaxError)).toBe(true);
  });
});
