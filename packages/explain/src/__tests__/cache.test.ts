import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CacheEntry, createDiskCache } from "../cache";

const entry = (key: string, summary = "Resumo."): CacheEntry => ({
  schemaVersion: 1,
  key,
  model: "~deepseek/deepseek-v4-flash-latest",
  promptVersion: "abcdef123456",
  createdAt: "2026-10-13T00:00:00.000Z",
  result: {
    summary,
    inputs: ["a"],
    outputs: ["b"],
    suggestions: [
      { command: "Valide a.", reason: "motivo", line: 2, severity: "alta" },
    ],
  },
});

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "code2n8n-cache-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createDiskCache (CORE-18)", () => {
  it("returns the stored entry for the same key", async () => {
    const cache = createDiskCache(root);
    await cache.set(entry("k1"));
    expect(await cache.get("k1")).toEqual(entry("k1"));
  });

  it("returns undefined for a missing key", async () => {
    expect(await createDiskCache(root).get("missing")).toBeUndefined();
  });

  it("treats a corrupted file as missing and overwrites it on the next set", async () => {
    await writeFile(join(root, "k1.json"), "{ corrompido", "utf8");
    const cache = createDiskCache(root);
    expect(await cache.get("k1")).toBeUndefined();
    await cache.set(entry("k1", "Novo."));
    expect(await cache.get("k1")).toEqual(entry("k1", "Novo."));
  });

  it("creates the directory when it does not exist", async () => {
    const dir = join(root, "nested", "explain");
    const cache = createDiskCache(dir);
    await cache.set(entry("k1"));
    expect(existsSync(join(dir, "k1.json"))).toBe(true);
    expect(await cache.get("k1")).toEqual(entry("k1"));
  });

  it("leaves no temporary file behind after set", async () => {
    const cache = createDiskCache(root);
    await cache.set(entry("k1"));
    await cache.set(entry("k2"));
    expect((await readdir(root)).sort()).toEqual(["k1.json", "k2.json"]);
  });

  it("persists across cache instances on the same directory", async () => {
    await createDiskCache(root).set(entry("k1"));
    expect(await createDiskCache(root).get("k1")).toEqual(entry("k1"));
  });
});
