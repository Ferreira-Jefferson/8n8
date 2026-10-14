import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Parser } from "web-tree-sitter";
import { loadPythonParser } from "../parse";

const videoFixture = readFileSync(
  new URL("./fixtures/pedido_frete.py", import.meta.url),
  "utf8",
);

function topLevelFunctionNames(parser: Parser, source: string): string[] {
  const root = parser.parse(source)?.rootNode;
  return (root?.namedChildren ?? [])
    .filter((n) => n.type === "function_definition")
    .map((n) => n.childForFieldName("name")?.text ?? "");
}

describe("loadPythonParser", () => {
  it("parses the video fixture without errors into two top-level functions", async () => {
    const parser = await loadPythonParser();
    const tree = parser.parse(videoFixture);

    expect(tree?.rootNode.hasError).toBe(false);
    expect(topLevelFunctionNames(parser, videoFixture)).toEqual([
      "calcular_frete",
      "processar_pedido",
    ]);
  });

  it("keeps both functions in the tree when the second has a syntax error", async () => {
    const parser = await loadPythonParser();
    const source = "def a():\n  pass\ndef b(:\n  pass";
    const tree = parser.parse(source);

    expect(tree?.rootNode.hasError).toBe(true);
    expect(topLevelFunctionNames(parser, source)).toEqual(["a", "b"]);
  });

  it("returns working parsers on repeated calls and loads the grammar once", async () => {
    const first = await loadPythonParser();
    const second = await loadPythonParser();

    expect(second).not.toBe(first);
    expect(second.language).toBe(first.language);
    expect(first.parse("x = 1")?.rootNode.type).toBe("module");
    expect(
      second.parse("def f():\n  pass")?.rootNode.firstNamedChild?.type,
    ).toBe("function_definition");
  });
});
