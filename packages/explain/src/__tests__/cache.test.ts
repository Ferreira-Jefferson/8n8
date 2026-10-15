import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Suggestion, Summary } from "@8n8/model";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CacheEntry,
  createSuggestionsCache,
  createSummaryCache,
  type PartCache,
} from "../cache";

const fileName = (nodeId: string) =>
  `${createHash("sha256").update(nodeId).digest("hex")}.json`;

const fingerprint = (code: string) => ({
  code,
  neighbours: "n31gh",
  provider: "openrouter",
  model: "~deepseek/deepseek-v4-flash-latest",
  reviewModel: "~deepseek/deepseek-v4-flash-latest",
  promptVersion: "abcdef123456",
  reviewerVersion: "123456abcdef",
});

const summaryOf = (text: string): Summary => ({
  summary: text,
  sentences: [{ id: "s1", text, lines: [1] }],
  inputs: [{ id: "i1", text: "a", lines: [1] }],
  outputs: [{ id: "o1", text: "b", lines: [2] }],
});

const suggestionsOf = (text: string): Suggestion[] => [
  {
    id: "g1",
    command: text,
    reason: "motivo",
    line: 2,
    severity: "alta",
    lines: [2],
  },
];

/** Each part: its cache, its folder and a result per text. */
const PARTS = [
  {
    name: "summary",
    folder: "nodes",
    create: createSummaryCache as (dir: string) => PartCache<unknown>,
    result: summaryOf as (text: string) => unknown,
  },
  {
    name: "suggestions",
    folder: "suggestions",
    create: createSuggestionsCache as (dir: string) => PartCache<unknown>,
    result: suggestionsOf as (text: string) => unknown,
  },
];

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "8n8-cache-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe.each(PARTS)(
  "$name cache (CORE-18, CACHE-06, CACHE-07, CFG-04)",
  ({ folder, create, result }) => {
    const entry = (
      nodeId: string,
      text = "Resumo.",
      code = "c0de",
    ): CacheEntry<unknown> => ({
      schemaVersion: 4,
      nodeId,
      fingerprint: fingerprint(code),
      review: "full",
      createdAt: "2026-10-13T00:00:00.000Z",
      result: result(text),
    });
    const files = () => join(root, folder);
    const writeRaw = async (nodeId: string, value: unknown) => {
      await mkdir(files(), { recursive: true });
      await writeFile(
        join(files(), fileName(nodeId)),
        typeof value === "string" ? value : JSON.stringify(value),
        "utf8",
      );
    };

    it("returns the stored entry for the same node, from its own folder", async () => {
      const cache = create(root);
      await cache.set(entry("fn:a"));
      expect(await cache.get("fn:a")).toEqual(entry("fn:a"));
      expect(await readdir(files())).toEqual([fileName("fn:a")]);
    });

    it("returns undefined for a missing node", async () => {
      expect(await create(root).get("fn:missing")).toBeUndefined();
    });

    it("treats a corrupted file as missing and overwrites it on the next set", async () => {
      await writeRaw("fn:a", "{ corrompido");
      const cache = create(root);
      expect(await cache.get("fn:a")).toBeUndefined();
      await cache.set(entry("fn:a", "Novo."));
      expect(await cache.get("fn:a")).toEqual(entry("fn:a", "Novo."));
    });

    it("creates the directory when it does not exist", async () => {
      const dir = join(root, "nested", "explain");
      const cache = create(dir);
      await cache.set(entry("fn:a"));
      expect(existsSync(join(dir, folder, fileName("fn:a")))).toBe(true);
    });

    it("leaves no temporary file behind and persists across instances", async () => {
      await create(root).set(entry("fn:a"));
      await create(root).set(entry("fn:b"));
      expect((await readdir(files())).sort()).toEqual(
        [fileName("fn:a"), fileName("fn:b")].sort(),
      );
      expect(await create(root).get("fn:a")).toEqual(entry("fn:a"));
    });

    it("keeps a single file per node: a second set replaces the first (CACHE-06)", async () => {
      const cache = create(root);
      await cache.set(entry("fn:a", "Primeiro.", "code-1"));
      await cache.set(entry("fn:a", "Segundo.", "code-2"));
      expect(await readdir(files())).toEqual([fileName("fn:a")]);
      expect(await cache.get("fn:a")).toEqual(
        entry("fn:a", "Segundo.", "code-2"),
      );
    });

    it("names files without ':' or '/' for cls:A/fn:b", async () => {
      const cache = create(root);
      await cache.set(entry("cls:A/fn:b"));
      expect(await readdir(files())).toEqual([fileName("cls:A/fn:b")]);
      expect(await cache.get("cls:A/fn:b")).toEqual(entry("cls:A/fn:b"));
    });

    it.each([1, 2, 3])(
      "returns undefined for a schemaVersion %i entry (CACHE-07, CFG-04)",
      async (version) => {
        await writeRaw("fn:a", { ...entry("fn:a"), schemaVersion: version });
        expect(await create(root).get("fn:a")).toBeUndefined();
      },
    );

    it("returns undefined for a fingerprint without provider or a result of another shape (CACHE-07)", async () => {
      const { provider: _, ...noProvider } = fingerprint("c0de");
      await writeRaw("fn:a", { ...entry("fn:a"), fingerprint: noProvider });
      expect(await create(root).get("fn:a")).toBeUndefined();
      await writeRaw("fn:a", { ...entry("fn:a"), result: { other: true } });
      expect(await create(root).get("fn:a")).toBeUndefined();
    });
  },
);

describe("the two parts never share a file (CFG-04)", () => {
  it("keeps a summary and suggestions of the same node apart", async () => {
    const summaries = createSummaryCache(root);
    const suggestions = createSuggestionsCache(root);
    const base = {
      schemaVersion: 4 as const,
      nodeId: "fn:a",
      fingerprint: fingerprint("c0de"),
      review: "full" as const,
      createdAt: "2026-10-13T00:00:00.000Z",
    };
    await summaries.set({ ...base, result: summaryOf("Resumo.") });
    await suggestions.set({ ...base, result: suggestionsOf("Valide.") });
    expect((await summaries.get("fn:a"))?.result).toEqual(summaryOf("Resumo."));
    expect((await suggestions.get("fn:a"))?.result).toEqual(
      suggestionsOf("Valide."),
    );
  });

  it("never reads a summary as suggestions, nor the reverse", async () => {
    const base = {
      schemaVersion: 4,
      nodeId: "fn:a",
      fingerprint: fingerprint("c0de"),
      review: "full",
      createdAt: "2026-10-13T00:00:00.000Z",
    };
    await mkdir(join(root, "suggestions"), { recursive: true });
    await writeFile(
      join(root, "suggestions", fileName("fn:a")),
      JSON.stringify({ ...base, result: summaryOf("Resumo.") }),
    );
    expect(await createSuggestionsCache(root).get("fn:a")).toBeUndefined();
    await mkdir(join(root, "nodes"), { recursive: true });
    await writeFile(
      join(root, "nodes", fileName("fn:a")),
      JSON.stringify({ ...base, result: suggestionsOf("Valide.") }),
    );
    expect(await createSummaryCache(root).get("fn:a")).toBeUndefined();
  });
});
