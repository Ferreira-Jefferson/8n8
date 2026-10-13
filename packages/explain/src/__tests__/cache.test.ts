import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CacheEntryV2, createDiskCache } from "../cache";

const fileName = (nodeId: string) =>
  `${createHash("sha256").update(nodeId).digest("hex")}.json`;

const entry = (
  nodeId: string,
  summary = "Resumo.",
  code = "c0de",
): CacheEntryV2 => ({
  schemaVersion: 2,
  nodeId,
  fingerprint: {
    code,
    neighbours: "n31gh",
    model: "~deepseek/deepseek-v4-flash-latest",
    reviewModel: "~deepseek/deepseek-v4-flash-latest",
    promptVersion: "abcdef123456",
    reviewerVersion: "123456abcdef",
  },
  review: "full",
  createdAt: "2026-10-13T00:00:00.000Z",
  result: {
    summary,
    sentences: [{ id: "s1", text: summary, lines: [1] }],
    inputs: [{ id: "i1", text: "a", lines: [1] }],
    outputs: [{ id: "o1", text: "b", lines: [2] }],
    suggestions: [
      {
        id: "g1",
        command: "Valide a.",
        reason: "motivo",
        line: 2,
        severity: "alta",
        lines: [2],
      },
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

const nodes = () => join(root, "nodes");

describe("createDiskCache (CORE-18, CACHE-06, CACHE-07)", () => {
  it("returns the stored entry for the same node", async () => {
    const cache = createDiskCache(root);
    await cache.set(entry("fn:a"));
    expect(await cache.get("fn:a")).toEqual(entry("fn:a"));
  });

  it("returns undefined for a missing node", async () => {
    expect(await createDiskCache(root).get("fn:missing")).toBeUndefined();
  });

  it("treats a corrupted file as missing and overwrites it on the next set", async () => {
    await mkdir(nodes(), { recursive: true });
    await writeFile(join(nodes(), fileName("fn:a")), "{ corrompido", "utf8");
    const cache = createDiskCache(root);
    expect(await cache.get("fn:a")).toBeUndefined();
    await cache.set(entry("fn:a", "Novo."));
    expect(await cache.get("fn:a")).toEqual(entry("fn:a", "Novo."));
  });

  it("creates the directory when it does not exist", async () => {
    const dir = join(root, "nested", "explain");
    const cache = createDiskCache(dir);
    await cache.set(entry("fn:a"));
    expect(existsSync(join(dir, "nodes", fileName("fn:a")))).toBe(true);
    expect(await cache.get("fn:a")).toEqual(entry("fn:a"));
  });

  it("leaves no temporary file behind after set", async () => {
    const cache = createDiskCache(root);
    await cache.set(entry("fn:a"));
    await cache.set(entry("fn:b"));
    expect((await readdir(nodes())).sort()).toEqual(
      [fileName("fn:a"), fileName("fn:b")].sort(),
    );
  });

  it("persists across cache instances on the same directory", async () => {
    await createDiskCache(root).set(entry("fn:a"));
    expect(await createDiskCache(root).get("fn:a")).toEqual(entry("fn:a"));
  });

  it("keeps a single file per node: a second set with another fingerprint replaces the first (CACHE-06)", async () => {
    const cache = createDiskCache(root);
    await cache.set(entry("fn:a", "Primeiro.", "code-1"));
    await cache.set(entry("fn:a", "Segundo.", "code-2"));
    expect(await readdir(nodes())).toEqual([fileName("fn:a")]);
    expect(await cache.get("fn:a")).toEqual(
      entry("fn:a", "Segundo.", "code-2"),
    );
  });

  it("names files without ':' or '/' for fn:calcular_frete and cls:A/fn:b", async () => {
    const cache = createDiskCache(root);
    await cache.set(entry("fn:calcular_frete"));
    await cache.set(entry("cls:A/fn:b"));
    const files = await readdir(nodes());
    expect(files).toHaveLength(2);
    for (const f of files) expect(f).toMatch(/^[0-9a-f]{64}\.json$/);
    expect(await cache.get("cls:A/fn:b")).toEqual(entry("cls:A/fn:b"));
  });

  it("returns undefined for a schemaVersion 1 entry (CACHE-07)", async () => {
    await mkdir(nodes(), { recursive: true });
    await writeFile(
      join(nodes(), fileName("fn:a")),
      JSON.stringify({ ...entry("fn:a"), schemaVersion: 1 }),
      "utf8",
    );
    expect(await createDiskCache(root).get("fn:a")).toBeUndefined();
  });

  it("returns undefined for JSON of another shape (CACHE-07)", async () => {
    await mkdir(nodes(), { recursive: true });
    const { result, ...noResult } = entry("fn:a");
    await writeFile(
      join(nodes(), fileName("fn:a")),
      JSON.stringify({ ...noResult, result: { summary: result.summary } }),
      "utf8",
    );
    expect(await createDiskCache(root).get("fn:a")).toBeUndefined();
  });

  it("never reads a feature-01 file at the root of the directory (CACHE-07)", async () => {
    await writeFile(
      join(root, fileName("fn:a")),
      JSON.stringify(entry("fn:a")),
      "utf8",
    );
    expect(await createDiskCache(root).get("fn:a")).toBeUndefined();
  });
});
