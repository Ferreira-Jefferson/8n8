import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Fingerprint } from "./fingerprint";

export interface TitleCacheEntry {
  schemaVersion: 1;
  /** The nodeId in a snippet, `<POSIX root>|<nodeId>` in a project. */
  cacheKey: string;
  fingerprint: Fingerprint;
  /** ISO date; informative only. */
  createdAt: string;
  /** Lines RELATIVE to the node. */
  title: { text: string; lines: number[] };
}

export interface TitleCache {
  get(cacheKey: string): Promise<TitleCacheEntry | undefined>;
  set(entry: TitleCacheEntry): Promise<void>;
}

const entrySchema = z.object({
  schemaVersion: z.literal(1),
  cacheKey: z.string(),
  fingerprint: z.object({
    code: z.string(),
    neighbours: z.string(),
    model: z.string(),
    reviewModel: z.string(),
    promptVersion: z.string(),
    reviewerVersion: z.string(),
  }),
  createdAt: z.string(),
  title: z.object({
    text: z.string(),
    lines: z.array(z.number().int()),
  }),
});

/** One JSON file per cache key in `<dir>/titles/<sha256(cacheKey)>.json`; atomic write (temp file + rename) (VID-17). */
export function createTitleCache(dir: string): TitleCache {
  const titles = join(dir, "titles");
  const fileOf = (cacheKey: string) =>
    join(titles, `${createHash("sha256").update(cacheKey).digest("hex")}.json`);
  return {
    async get(cacheKey) {
      try {
        const raw = JSON.parse(await readFile(fileOf(cacheKey), "utf8"));
        const parsed = entrySchema.safeParse(raw);
        return parsed.success ? parsed.data : undefined;
      } catch {
        // Missing or corrupted file: treated as absent.
        return undefined;
      }
    },
    async set(entry) {
      await mkdir(titles, { recursive: true });
      const tmp = join(titles, `${randomUUID()}.tmp`);
      await writeFile(tmp, JSON.stringify(entry), "utf8");
      await rename(tmp, fileOf(entry.cacheKey));
    },
  };
}
