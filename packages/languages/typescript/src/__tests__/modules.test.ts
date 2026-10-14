import { describe, expect, it } from "vitest";
import { resolveModulePath } from "../modules";

const files = new Set([
  "a.ts",
  "b.tsx",
  "lib/index.ts",
  "ui/index.tsx",
  "lib/util.ts",
  "lib/deep/x.ts",
  "script.js",
]);

describe("resolveModulePath", () => {
  it.each([
    ["lib/util.ts", "./util", "lib/util.ts"],
    ["lib/util.ts", "./util.ts", "lib/util.ts"],
    ["lib/util.ts", "./util.js", "lib/util.ts"],
    ["lib/util.ts", "../a", "a.ts"],
    ["lib/util.ts", "../b", "b.tsx"],
    ["lib/util.ts", "../b.js", "b.tsx"],
    ["a.ts", "./lib", "lib/index.ts"],
    ["a.ts", "./lib/", "lib/index.ts"],
    ["a.ts", "./ui", "ui/index.tsx"],
    ["a.ts", "./lib/deep/x", "lib/deep/x.ts"],
    ["lib/deep/x.ts", "../../a", "a.ts"],
    ["lib/deep/x.ts", "../util", "lib/util.ts"],
    ["a.ts", "./script.js", "script.js"],
  ])("from %s, %s is %s", (from, specifier, expected) => {
    expect(resolveModulePath(from, specifier, files)).toBe(expected);
  });

  it.each([
    ["a.ts", "react"],
    ["a.ts", "node:fs"],
    ["a.ts", "@scope/pkg"],
    ["a.ts", "./missing"],
    ["a.ts", "../outside"],
    ["lib/util.ts", "../../outside"],
    ["a.ts", "."],
    ["a.ts", "./data.json"],
  ])("from %s, %s is not a project file", (from, specifier) => {
    expect(resolveModulePath(from, specifier, files)).toBeNull();
  });
});
