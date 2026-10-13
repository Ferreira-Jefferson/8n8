import { readFileSync } from "node:fs";
import type { FlowNode, Graph } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { buildGraph } from "../build-graph";
import { markSyntaxErrors } from "../errors";
import { loadPythonParser } from "../parse";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

/** 1-based line of the first line containing `text`. */
function lineOf(source: string, text: string): number {
  return source.split("\n").findIndex((l) => l.includes(text)) + 1;
}

async function extract(
  source: string,
): Promise<{ built: Graph; marked: Graph }> {
  const parser = await loadPythonParser();
  const tree = parser.parse(source);
  if (!tree) throw new Error("parse failed");
  const built = buildGraph(tree);
  return { built, marked: markSyntaxErrors(tree, built) };
}

function marks(graph: Graph): [string, number | undefined][] {
  return graph.nodes
    .filter((n) => n.syntaxError !== undefined)
    .map((n) => [n.id, n.syntaxError?.line]);
}

function node(graph: Graph, id: string): FlowNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

describe("markSyntaxErrors (CORE-06)", () => {
  it("keeps the other functions and marks b when a paren is left open inside it", async () => {
    const source = fixture("errors/parentese_aberto.py");
    const { marked } = await extract(source);

    const tops = marked.nodes.filter((n) => n.parentId === null);
    expect(tops.map((n) => n.id)).toEqual(["fn:a", "fn:b", "fn:c"]);
    const errors = marks(marked);
    expect(errors).toHaveLength(1);
    const [id, line] = errors[0] ?? [];
    expect(id === "fn:b" || id?.startsWith("fn:b/")).toBe(true);
    expect(line).toBe(lineOf(source, "soma(1"));
  });

  it("keeps both functions and marks fn:b for def b(:", async () => {
    const source = fixture("errors/parametro_sem_fecha.py");
    const { marked } = await extract(source);

    expect(
      marked.nodes.filter((n) => n.parentId === null).map((n) => n.id),
    ).toEqual(["fn:a", "fn:b"]);
    expect(marks(marked)).toEqual([["fn:b", lineOf(source, "def b(")]]);
  });

  it("marks the innermost node of the line on an indentation error", async () => {
    const source = fixture("errors/indentacao.py");
    const { marked } = await extract(source);

    const line = lineOf(source, "y = 2");
    expect(node(marked, "fn:a/s0")).toMatchObject({
      kind: "code",
      range: { start: 2, end: 4 },
    });
    expect(marks(marked)).toEqual([["fn:a/s0", line]]);
    expect(node(marked, "fn:b")).toBeDefined();
  });

  it("creates and marks the module for an error outside functions in a snippet without module", async () => {
    const source = fixture("errors/fora_de_funcao.py");
    const { built, marked } = await extract(source);

    expect(node(built, "mod")).toBeUndefined();
    const line = lineOf(source, "x = (1");
    expect(node(marked, "mod")).toEqual({
      id: "mod",
      kind: "module",
      label: "Módulo",
      parentId: null,
      range: { start: line, end: line },
      openable: true,
      syntaxError: { line },
    });
    expect(marks(marked)).toEqual([["mod", line]]);
  });

  it("marks fn:a on its header line when its body is not indented", async () => {
    const source = "def a():\nx = 1\n\n\ndef b():\n    return 2\n";
    const { marked } = await extract(source);

    expect(node(marked, "fn:b")).toBeDefined();
    expect(marks(marked)).toEqual([["fn:a", 1]]);
  });

  it("marks a def with no body before another def", async () => {
    const source = "def a():\ndef b():\n    return 1\n";
    const { marked } = await extract(source);

    expect(node(marked, "fn:b")).toBeDefined();
    expect(marks(marked)).toEqual([["fn:a", 1]]);
  });

  it("marks a def with no body at the end of the snippet", async () => {
    const source = "def a():\n    return 1\n\n\ndef b():\n";
    const { marked } = await extract(source);

    expect(node(marked, "fn:a")).toBeDefined();
    expect(marks(marked)).toEqual([["fn:b", 5]]);
  });

  it("marks the condition of an if with no body on the if line", async () => {
    const source = "def f(x):\n    if x:\n    y = 1\n";
    const { marked } = await extract(source);

    expect(node(marked, "fn:f/s0")).toMatchObject({ kind: "condition" });
    expect(marks(marked)).toEqual([["fn:f/s0", 2]]);
  });

  it("marks no node in a valid snippet", async () => {
    const { marked } = await extract(fixture("pedido_frete.py"));

    expect(marks(marked)).toEqual([]);
  });
});
