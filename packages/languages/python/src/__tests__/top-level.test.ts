import { describe, expect, it } from "vitest";
import { allocateTopLevel } from "../build-graph";
import { loadPythonParser } from "../parse";

async function topLevelOf(source: string) {
  const parser = await loadPythonParser();
  const tree = parser.parse(source);
  if (!tree) throw new Error("parse failed");
  return allocateTopLevel(tree.rootNode);
}

describe("allocateTopLevel", () => {
  it("numbers a repeated def and lets the last one win the name", async () => {
    const top = await topLevelOf(
      "def f():\n    pass\n\nclass X:\n    pass\n\ndef f():\n    pass\n",
    );

    expect(top.ids).toEqual(["fn:f", "cls:X", "fn:f#2"]);
    expect(top.topLevel.get("f")).toBe("fn:f#2");
    expect(top.topLevel.get("X")).toBe("cls:X");
    expect(top.names.get("fn:f")).toBe("f");
  });
});
