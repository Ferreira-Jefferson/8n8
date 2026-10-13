import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forbiddenUses } from "../scan";

const SRC = join(__dirname, "..");
const sources = readdirSync(SRC)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ name: f, text: readFileSync(join(SRC, f), "utf-8") }));

describe("forbiddenUses", () => {
  it("finds every write-capable API in a sample text", () => {
    const sample = [
      "writeFile(a)",
      "appendFile(a)",
      "mkdir(a)",
      "rm(a)",
      "rename(a, b)",
      "unlink(a)",
      "copyFile(a, b)",
      "chmod(a)",
      "open(a)",
      'import "node:child_process"',
    ].join("\n");
    expect(forbiddenUses(sample).sort()).toEqual(
      [
        "writeFile",
        "appendFile",
        "mkdir",
        "rm",
        "rename",
        "unlink",
        "copyFile",
        "chmod",
        "open(",
        "child_process",
      ].sort(),
    );
  });

  it("finds nothing in a plain read", () => {
    expect(forbiddenUses("const t = await readFile(p);")).toEqual([]);
  });
});

describe("package sources", () => {
  it("scans at least the known modules", () => {
    expect(sources.map((s) => s.name)).toEqual(
      expect.arrayContaining(["fs-read.ts", "scan.ts", "index.ts"]),
    );
  });

  it.each(sources.map((s) => [s.name, s.text]))(
    "%s uses no write-capable API",
    (_name, text) => {
      expect(forbiddenUses(text as string)).toEqual([]);
    },
  );

  it("only fs-read.ts imports node:fs", () => {
    const importers = sources
      .filter((s) => /from\s+["']node:fs/.test(s.text))
      .map((s) => s.name);
    expect(importers).toEqual(["fs-read.ts"]);
  });
});
