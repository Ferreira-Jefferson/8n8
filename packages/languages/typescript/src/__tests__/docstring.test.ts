import { describe, expect, it } from "vitest";
import { extract, node } from "./helpers";

describe("JSDoc", () => {
  it("points the block right above a function", () => {
    const graph = extract(
      "/**\n * Soma.\n * @param a\n */\nfunction soma(a) {}\n",
    );

    expect(node(graph, "fn:soma").docstring).toEqual({ start: 1, end: 4 });
  });

  it("points a one-line block above an exported function", () => {
    const graph = extract("/** Soma. */\nexport function soma() {}\n");

    expect(node(graph, "fn:soma").docstring).toEqual({ start: 1, end: 1 });
  });

  it("points the block above an arrow function assigned to a const", () => {
    const graph = extract(
      "/** Dobra. */\nexport const dobra = (x) => x * 2;\n",
    );

    expect(node(graph, "fn:dobra").docstring).toEqual({ start: 1, end: 1 });
  });

  it("points the block above a class, and above a method", () => {
    const graph = extract(
      "/** Caixa. */\nclass Box {\n  /** Abre. */\n  open() {}\n  close() {}\n}\n",
    );

    expect(node(graph, "cls:Box").docstring).toEqual({ start: 1, end: 1 });
    expect(node(graph, "cls:Box/fn:open").docstring).toEqual({
      start: 3,
      end: 3,
    });
    expect(node(graph, "cls:Box/fn:close").docstring).toBeUndefined();
  });

  it("points the block above the decorators of a method", () => {
    const graph = extract(
      "class A {\n  /** Acha. */\n  @Get()\n  find() {}\n}\n",
    );

    expect(node(graph, "cls:A/fn:find").docstring).toEqual({
      start: 2,
      end: 2,
    });
  });

  it("points the block of the module when it opens the file and is not for the next definition", () => {
    const graph = extract(
      "/** O arquivo. */\n\nconst a = 1;\nfunction f() {}\n",
    );

    expect(node(graph, "mod").docstring).toEqual({ start: 1, end: 1 });
    expect(node(graph, "mod").range.start).toBe(1);
    expect(node(graph, "fn:f").docstring).toBeUndefined();
  });

  it("gives the block to the function right below it, not to the module", () => {
    const graph = extract("/** Da função. */\nfunction f() {}\nconst a = 1;\n");

    expect(node(graph, "fn:f").docstring).toEqual({ start: 1, end: 1 });
    expect(node(graph, "mod").docstring).toBeUndefined();
  });

  it("does not point a block separated by a blank line", () => {
    const graph = extract("/** Solto. */\n\nfunction f() {}\n");

    expect(node(graph, "fn:f").docstring).toBeUndefined();
  });

  it("does not take a // comment or a /* */ comment as documentation", () => {
    const graph = extract(
      "// nota\nfunction a() {}\n/* nota */\nfunction b() {}\n",
    );

    expect(node(graph, "fn:a").docstring).toBeUndefined();
    expect(node(graph, "fn:b").docstring).toBeUndefined();
  });

  it("does not take a block that comes after the definition", () => {
    const graph = extract("function a() {}\n/** Depois. */\nconst x = 1;\n");

    expect(node(graph, "fn:a").docstring).toBeUndefined();
  });
});
