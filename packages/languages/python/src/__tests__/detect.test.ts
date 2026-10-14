import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectPython } from "../detect";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

const TYPESCRIPT = [
  'import { readFileSync } from "node:fs";',
  "",
  "export interface Item { peso: number }",
  "",
  "export function total(itens: Item[]): number {",
  "  let soma = 0;",
  "  for (const item of itens) {",
  "    soma += item.peso;",
  "  }",
  "  return soma;",
  "}",
].join("\n");

const JAVASCRIPT = [
  "const total = (itens) => {",
  "  if (itens === null || itens.length === 0) return undefined;",
  "  return itens.reduce((a, b) => a + b, 0);",
  "};",
].join("\n");

const JAVA = [
  "public class Frete {",
  "    private static final double BASE = 10;",
  "    public static void main(String[] args) {",
  "        System.out.println(BASE);",
  "    }",
  "}",
].join("\n");

const C = [
  "#include <stdio.h>",
  "",
  "int main(void) {",
  '    printf("oi");',
  "    return 0;",
  "}",
].join("\n");

describe("detectPython: Python text", () => {
  it.each([
    ["a function with a loop", fixture("pedido_frete.py")],
    ["the video fixture", fixture("pedido_video.py")],
    [
      "a class with self",
      "class Caixa:\n    def __init__(self, n):\n        self.n = n\n",
    ],
    [
      "imports and an if/elif chain",
      "import os\nfrom a.b import c\n\nif c:\n    pass\nelif os:\n    pass\nelse:\n    pass\n",
    ],
    [
      "a decorated async function",
      "@app.get('/x')\nasync def x():\n    return None\n",
    ],
  ])("scores %s high", (_name, source) => {
    expect(detectPython(source)).toBeGreaterThanOrEqual(0.7);
  });
});

describe("detectPython: text of other languages", () => {
  it.each([
    ["TypeScript", TYPESCRIPT],
    ["JavaScript", JAVASCRIPT],
    ["Java", JAVA],
    ["C", C],
  ])("scores %s at zero or nearly", (_name, source) => {
    expect(detectPython(source)).toBeLessThan(0.15);
  });

  it("scores lower for Python with braces and semicolons mixed in", () => {
    const clean = "def f(x):\n    return x\n";

    expect(detectPython("def f(x) {\n    return x;\n}\n")).toBeLessThan(
      detectPython(clean),
    );
  });
});

describe("detectPython: short and ambiguous text", () => {
  it("gives a low, non-zero score to a one-line assignment", () => {
    const score = detectPython("x = 1");

    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.3);
  });

  it("gives a low score to a one-line call that other languages share", () => {
    expect(detectPython('print("oi")')).toBeLessThan(0.4);
    expect(detectPython("foo(1, 2)")).toBe(0);
  });

  it("scores a single def line above an assignment, below a whole function", () => {
    const def = detectPython("def f(x):");

    expect(def).toBeGreaterThan(detectPython("x = 1"));
    expect(def).toBeLessThan(detectPython(fixture("pedido_frete.py")));
  });

  it("scores empty text at zero and a comment-only text low", () => {
    expect(detectPython("")).toBe(0);
    expect(detectPython("   \n\n")).toBe(0);
    expect(detectPython("# nada\n")).toBeLessThanOrEqual(0.2);
  });

  it("does not take a C preprocessor line for a Python comment", () => {
    expect(detectPython("#include <a.h>")).toBe(0);
  });

  it("stays between 0 and 1 and gives the same score for the same text", () => {
    for (const source of [
      "",
      "x = 1",
      fixture("pedido_video.py"),
      "def a(): pass;\n}{",
      "self self self None True False\n".repeat(50),
    ]) {
      const score = detectPython(source);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThan(1);
      expect(detectPython(source)).toBe(score);
    }
  });
});
