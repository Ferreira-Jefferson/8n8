import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTitleCache,
  type TitleCache,
  type TitleCacheEntry,
} from "../title-cache";

let dir: string;
let cache: TitleCache;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "code2n8n-titles-"));
  cache = createTitleCache(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const titlesDir = () => join(dir, "titles");
const fileOf = (key: string) =>
  join(titlesDir(), `${createHash("sha256").update(key).digest("hex")}.json`);

const entry = (cacheKey: string): TitleCacheEntry => ({
  schemaVersion: 1,
  cacheKey,
  fingerprint: {
    code: "c",
    neighbours: "n",
    model: "m",
    reviewModel: "r",
    promptVersion: "p",
    reviewerVersion: "v",
  },
  createdAt: "2026-10-13T00:00:00.000Z",
  title: { text: "Calcular frete", lines: [1, 2] },
});

describe("createTitleCache (VID-17)", () => {
  it("writes <dir>/titles/<sha256(cacheKey)>.json with schemaVersion 1 and reads it back", async () => {
    await cache.set(entry("fn:a"));
    const stored = JSON.parse(await readFile(fileOf("fn:a"), "utf8"));
    expect(stored).toEqual(entry("fn:a"));
    expect(stored.schemaVersion).toBe(1);
    expect(await cache.get("fn:a")).toEqual(entry("fn:a"));
    expect(await readdir(titlesDir())).toHaveLength(1);
  });

  it("returns undefined for a missing key", async () => {
    expect(await cache.get("fn:nada")).toBeUndefined();
  });

  it.each([
    ["invalid JSON", "{ corrompido"],
    ["schemaVersion 2", JSON.stringify({ ...entry("fn:a"), schemaVersion: 2 })],
    ["a missing field", JSON.stringify({ ...entry("fn:a"), title: undefined })],
  ])(
    "treats %s as absent and lets the next set overwrite it",
    async (_, raw) => {
      await mkdir(titlesDir(), { recursive: true });
      await writeFile(fileOf("fn:a"), raw, "utf8");
      expect(await cache.get("fn:a")).toBeUndefined();
      await cache.set(entry("fn:a"));
      expect(await cache.get("fn:a")).toEqual(entry("fn:a"));
    },
  );

  it("keeps a snippet key and a project key apart", async () => {
    await cache.set(entry("fn:a"));
    await cache.set({
      ...entry("C:/x|fn:a"),
      title: { text: "Outro", lines: [1] },
    });
    expect(await readdir(titlesDir())).toHaveLength(2);
    expect((await cache.get("fn:a"))?.title.text).toBe("Calcular frete");
    expect((await cache.get("C:/x|fn:a"))?.title.text).toBe("Outro");
  });
});
