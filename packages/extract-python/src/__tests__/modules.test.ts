import { describe, expect, it } from "vitest";
import { moduleNameOf, packageOf, relativeBase } from "../modules";

describe("moduleNameOf", () => {
  it("joins the path segments with dots", () => {
    expect(moduleNameOf("a/b/c.py")).toBe("a.b.c");
  });

  it("names a package by its __init__.py folder", () => {
    expect(moduleNameOf("a/b/__init__.py")).toBe("a.b");
  });

  it("gives no name to the root __init__.py", () => {
    expect(moduleNameOf("__init__.py")).toBeNull();
  });

  it("names a root file by its stem", () => {
    expect(moduleNameOf("main.py")).toBe("main");
  });
});

describe("packageOf", () => {
  it("is the folder of a module", () => {
    expect(packageOf("a/b/c.py")).toBe("a.b");
  });

  it("is the package itself for an __init__.py", () => {
    expect(packageOf("a/b/__init__.py")).toBe("a.b");
  });

  it("is empty for a root file", () => {
    expect(packageOf("main.py")).toBe("");
  });
});

describe("relativeBase", () => {
  it("is the package at level 1", () => {
    expect(relativeBase("a/b/c.py", 1)).toBe("a.b");
  });

  it("goes up one package at level 2", () => {
    expect(relativeBase("a/b/c.py", 2)).toBe("a");
  });

  it("is null above the root", () => {
    expect(relativeBase("a/b/c.py", 3)).toBeNull();
  });

  it("is the package itself for an __init__.py at level 1", () => {
    expect(relativeBase("a/b/__init__.py", 1)).toBe("a.b");
  });
});
