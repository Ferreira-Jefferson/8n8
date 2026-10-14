import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLanguage, loadParser } from "../parser";

const resolve = createRequire(import.meta.url).resolve;
const python = resolve("tree-sitter-python/tree-sitter-python.wasm");
const typescript = resolve(
  "tree-sitter-typescript/tree-sitter-typescript.wasm",
);

describe("loadLanguage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("runs Parser.init once for two calls and for two grammars", async () => {
    vi.resetModules();
    const { Parser: Fresh } = await import("web-tree-sitter");
    const init = vi.spyOn(Fresh, "init");
    const fresh = await import("../parser");
    await fresh.loadLanguage(python);
    await fresh.loadLanguage(python);
    await fresh.loadLanguage(typescript);

    expect(init).toHaveBeenCalledTimes(1);
  });

  it("returns the same language for the same wasm path", async () => {
    const first = loadLanguage(python);
    const second = loadLanguage(python);

    expect(second).toBe(first);
    expect(await second).toBe(await first);
  });

  it("loads different grammars for different wasm paths", async () => {
    const [py, ts] = await Promise.all([
      loadLanguage(python),
      loadLanguage(typescript),
    ]);

    expect(py).not.toBe(ts);
  });

  it("rejects when the wasm does not exist", async () => {
    await expect(loadLanguage("/nao/existe.wasm")).rejects.toThrow();
  });
});

describe("loadParser", () => {
  it("returns a new parser per call that shares the loaded language", async () => {
    const first = await loadParser(python);
    const second = await loadParser(python);

    expect(second).not.toBe(first);
    expect(second.language).toBe(first.language);
    expect(first.parse("x = 1")?.rootNode.type).toBe("module");
  });

  it("parses each language with its own grammar", async () => {
    const py = await loadParser(python);
    const ts = await loadParser(typescript);

    expect(py.parse("def f():\n  pass")?.rootNode.firstNamedChild?.type).toBe(
      "function_definition",
    );
    expect(ts.parse("function f() {}")?.rootNode.firstNamedChild?.type).toBe(
      "function_declaration",
    );
    expect(py.language).not.toBe(ts.language);
  });
});
