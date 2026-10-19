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

  it("keeps the declarations after a broken one, with the error on its line", () => {
    const graph = extract(
      "export function ok() {\n  return 1;\n}\nexport function bad( {\n  return 2\n}\nexport function after() {\n  return ok();\n}\n",
    );

    expect(graph.nodes.filter((n) => n.parentId === null)).toEqual([
      expect.objectContaining({ id: "fn:ok", range: { start: 1, end: 3 } }),
      expect.objectContaining({ id: "mod", syntaxError: { line: 4 } }),
      expect.objectContaining({ id: "fn:after", range: { start: 7, end: 9 } }),
    ]);
    expect(node(graph, "fn:after/s0")).toMatchObject({ target: "fn:ok" });
    expect(node(graph, "fn:after").syntaxError).toBeUndefined();
  });

  it("keeps the line numbers after a broken part with accented text", () => {
    const graph = extract(
      'const ação = "é";\nfunction quebrada( {\n  return "ç";\n}\nclass Depois {\n  m() {}\n}\n',
    );

    expect(node(graph, "cls:Depois").range).toEqual({ start: 5, end: 7 });
    expect(graph.nodes.find((n) => n.syntaxError)?.syntaxError).toEqual({
      line: 2,
    });
  });

  it("still reports an error when TSX does not read it clean either", () => {
    const graph = extract(
      "export function Tela() {\n  const a = ;\n  return <div/>;\n}\n",
    );

    expect(graph.nodes.some((n) => n.syntaxError)).toBe(true);
  });
});
