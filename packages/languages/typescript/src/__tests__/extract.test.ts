import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { typescriptPlugin } from "../index";
import {
  expectWellFormed,
  extract,
  lines,
  node,
  outline,
  wires,
} from "./helpers";

const fixture = readFileSync(
  new URL("./fixtures/pedido-frete.ts", import.meta.url),
  "utf8",
);

describe("typescriptPlugin", () => {
  it("declares the typescript language", () => {
    expect(typescriptPlugin.id).toBe("typescript");
    expect(typescriptPlugin.label).toBe("TypeScript");
    expect(typescriptPlugin.extensions).toEqual([".ts", ".tsx"]);
    expect(typescriptPlugin.ignoredDirs).toEqual([
      ".next",
      ".turbo",
      "bower_components",
    ]);
    expect(typescriptPlugin.commentPrefix).toBe("//");
  });

  it("gives the same graph for the same text, matching the snapshot", () => {
    const first = extract(fixture);
    const second = extract(fixture);

    expect(second).toEqual(first);
    expect(JSON.stringify(first, null, 2)).toMatchSnapshot();
  });

  it("marks the graph as typescript", () => {
    expect(extract(fixture).language).toBe("typescript");
  });

  it("gives an empty graph for an empty text", () => {
    const graph = extract("");

    expect(graph.empty).toBe(true);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it("gives an empty graph for imports and types only", () => {
    const graph = extract(
      'import a from "a";\nexport interface I { x: number }\ntype T = string;\n',
    );

    expect(graph.empty).toBe(true);
  });
});

describe("the pedido-frete fixture", () => {
  const graph = extract(fixture);

  it("is well formed", () => {
    expectWellFormed(graph, lines(fixture));
  });

  it("has two functions, one `calls` wire", () => {
    expect(
      graph.nodes
        .filter((n) => n.parentId === null)
        .map((n) => [n.kind, n.label]),
    ).toEqual([
      ["function", "calcularFrete"],
      ["function", "processarPedido"],
    ]);
    expect(wires(graph, "calls")).toEqual([
      "fn:processarPedido -> fn:calcularFrete",
    ]);
  });

  it("walks calcularFrete: HTTP, code, a condition with two returns", () => {
    expect(
      outline(graph).filter(([id]) => id.startsWith("fn:calcularFrete/")),
    ).toEqual([
      ["fn:calcularFrete/s0", "external", "axios.get"],
      ["fn:calcularFrete/s1", "code", "Código"],
      ["fn:calcularFrete/s2", "condition", "peso > 30"],
      ["fn:calcularFrete/s2/b0/s0", "return", "base + taxa * 2"],
      ["fn:calcularFrete/s2/b1/s0", "return", "base + taxa"],
    ]);
    expect(node(graph, "fn:calcularFrete/s0").category).toBe("HTTP");
    expect(wires(graph, "branch")).toEqual([
      "fn:calcularFrete/s2 -> fn:calcularFrete/s2/b0/s0 [true]",
      "fn:calcularFrete/s2 -> fn:calcularFrete/s2/b1/s0 [false]",
    ]);
  });

  it("walks processarPedido: code, a loop that calls calcularFrete, a return", () => {
    const loop = node(graph, "fn:processarPedido/s1");
    expect([loop.kind, loop.label, loop.openable]).toEqual([
      "loop",
      "for (const item of itens)",
      true,
    ]);
    const call = node(graph, "fn:processarPedido/s1/s0");
    expect([call.kind, call.target, call.openable]).toEqual([
      "call",
      "fn:calcularFrete",
      true,
    ]);
    expect(node(graph, "fn:processarPedido/s2").kind).toBe("return");
  });

  it("links each step to the next with a `next` wire", () => {
    expect(wires(graph, "next")).toEqual([
      "fn:calcularFrete/s0 -> fn:calcularFrete/s1",
      "fn:calcularFrete/s1 -> fn:calcularFrete/s2",
      "fn:processarPedido/s0 -> fn:processarPedido/s1",
      "fn:processarPedido/s1 -> fn:processarPedido/s2",
    ]);
  });

  it("points the JSDoc of calcularFrete", () => {
    expect(node(graph, "fn:calcularFrete").docstring).toEqual({
      start: 3,
      end: 3,
    });
    expect(node(graph, "fn:processarPedido").docstring).toBeUndefined();
  });
});
