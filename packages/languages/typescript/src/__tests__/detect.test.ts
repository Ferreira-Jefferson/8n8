// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the strings are TypeScript sources under test
import { describe, expect, it } from "vitest";
import { typescriptPlugin } from "../index";

const detect = typescriptPlugin.detect;

describe("detect", () => {
  it("gives a high score to clear TypeScript", () => {
    const source = [
      'import { readFile } from "node:fs/promises";',
      "",
      "export interface Item { peso: number }",
      "",
      "export async function total(itens: Item[]): Promise<number> {",
      "  const base = 10;",
      "  return itens.reduce((acc, i) => acc + i.peso, base);",
      "}",
      "",
    ].join("\n");

    expect(detect(source)).toBeGreaterThan(0.85);
  });

  it("recognizes each form of the language on its own", () => {
    const forms = [
      'import a from "a";\nimport b from "b";',
      "export const x = 1;",
      "function f(a) { return a; }",
      "const f = (a) => a;",
      "interface A { x: number }",
      "type A = { x: number };",
      "class A {\n  m() {}\n}",
      "console.log(a === b);",
      'const a = require("a");',
      "const s = `x ${a}`;",
      "function f(a: number): string {\n  return '';\n}",
    ];

    for (const form of forms) {
      expect(detect(form), form).toBeGreaterThan(0.3);
    }
  });

  it("gives a low score to clear Python", () => {
    const source = [
      "import requests",
      "",
      "def calcular(peso, distancia):",
      "    # tabela",
      "    if peso > 30:",
      "        return None",
      "    elif peso > 10:",
      "        return self.base",
      "    else:",
      "        print(True)",
      "",
    ].join("\n");

    expect(detect(source)).toBeLessThan(0.1);
  });

  it("gives a low score to Python with type hints", () => {
    expect(
      detect("def f(a: int, b: str) -> int:\n    return a\n"),
    ).toBeLessThan(0.2);
  });

  it("gives a low score to an ambiguous line", () => {
    for (const line of ["x = 1", "foo(1)", "a", "print(a)", "x = [1, 2, 3]"]) {
      expect(detect(line), line).toBeLessThan(0.2);
    }
  });

  it("gives no score to an empty text", () => {
    expect(detect("")).toBe(0);
    expect(detect("  \n\n")).toBe(0);
  });

  it("halves the score of a text that no grammar reads clean", () => {
    const clean = detect("const a = 1;\nconst b = 2;\nconst c = 3;\n");
    const broken = detect("const a = 1;\nconst b = 2;\nconst c = ;;\n)\n");

    expect(broken).toBeLessThan(clean);
    expect(broken).toBeGreaterThan(0);
  });

  it("gives the same score for the same text", () => {
    const source = "export const x = (a: number) => a;\n";

    expect(detect(source)).toBe(detect(source));
  });

  it("stays between 0 and 1", () => {
    const heavy = "export const a = 1;\n".repeat(200);

    expect(detect(heavy)).toBeLessThanOrEqual(1);
    expect(detect(heavy)).toBeGreaterThan(0.7);
  });
});
