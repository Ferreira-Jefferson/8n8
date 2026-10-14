import type { LanguagePlugin } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { detectLanguage, pluginForPath } from "../detect";
import { fakePlugin } from "./fake-plugin";

/** A plugin whose score comes from a keyword: 0.9 when the text has it, else `base`. */
function scorer(id: string, keyword: string, base = 0): LanguagePlugin {
  return {
    ...fakePlugin(id, [`.${id}`]),
    detect: (source) => (source.includes(keyword) ? 0.9 : base),
  };
}

const py = scorer("py", "def ");
const ts = scorer("ts", "const ");

describe("detectLanguage", () => {
  it("picks the plugin with the best score for a clear Python-like snippet", () => {
    const r = detectLanguage("def f():\n    return 1\n", [py, ts]);
    expect(r.plugin).toBe(py);
    expect(r.uncertain).toBe(false);
  });

  it("picks the plugin with the best score for a clear TS-like snippet", () => {
    const r = detectLanguage("const x = 1;\n", [py, ts]);
    expect(r.plugin).toBe(ts);
    expect(r.uncertain).toBe(false);
  });

  it("is uncertain when the best score is low (a line like `x = 1`)", () => {
    const low = (id: string, score: number): LanguagePlugin => ({
      ...fakePlugin(id, [`.${id}`]),
      detect: () => score,
    });
    const r = detectLanguage("x = 1", [low("a", 0.3), low("b", 0.1)]);
    expect(r.plugin.id).toBe("a");
    expect(r.uncertain).toBe(true);
  });

  it("is uncertain when the two best scores are close, and the higher wins", () => {
    const fixed = (id: string, score: number): LanguagePlugin => ({
      ...fakePlugin(id, [`.${id}`]),
      detect: () => score,
    });
    const r = detectLanguage("x", [fixed("a", 0.7), fixed("b", 0.8)]);
    expect(r.plugin.id).toBe("b");
    expect(r.uncertain).toBe(true);
  });

  it("is not uncertain when the margin to the second is large enough", () => {
    const fixed = (id: string, score: number): LanguagePlugin => ({
      ...fakePlugin(id, [`.${id}`]),
      detect: () => score,
    });
    const r = detectLanguage("x", [fixed("a", 0.5), fixed("b", 0.8)]);
    expect(r.plugin.id).toBe("b");
    expect(r.uncertain).toBe(false);
  });

  it("keeps the first registered plugin in a total tie, and says it is uncertain", () => {
    const tied = (id: string): LanguagePlugin => ({
      ...fakePlugin(id, [`.${id}`]),
      detect: () => 0.9,
    });
    const r = detectLanguage("x", [tied("a"), tied("b")]);
    expect(r.plugin.id).toBe("a");
    expect(r.uncertain).toBe(true);
  });

  it("with a single plugin, is uncertain only by a low score", () => {
    expect(detectLanguage("def f(): pass", [py]).uncertain).toBe(false);
    const r = detectLanguage("x = 1", [py]);
    expect(r.plugin).toBe(py);
    expect(r.uncertain).toBe(true);
  });

  it("throws a clear error without plugins", () => {
    expect(() => detectLanguage("x", [])).toThrow(
      "no language plugin registered",
    );
  });
});

describe("pluginForPath", () => {
  const a = fakePlugin("a", [".a", ".aa"]);
  const b = fakePlugin("b", [".b"]);

  it("finds the plugin by extension, ignoring case and folders", () => {
    expect(pluginForPath("src/x.A", [a, b])).toBe(a);
    expect(pluginForPath("src.b/y.aa", [a, b])).toBe(a);
    expect(pluginForPath("z.B", [a, b])).toBe(b);
  });

  it("gives the first plugin that serves the extension", () => {
    const dup = fakePlugin("dup", [".a"]);
    expect(pluginForPath("x.a", [a, dup])).toBe(a);
  });

  it("is undefined without a match or without extension", () => {
    expect(pluginForPath("x.c", [a, b])).toBeUndefined();
    expect(pluginForPath("Makefile", [a, b])).toBeUndefined();
  });
});
