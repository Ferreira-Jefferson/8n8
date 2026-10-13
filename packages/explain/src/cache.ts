import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Explanation } from "@code2n8n/model";

export interface CacheEntry {
  schemaVersion: 1;
  /** sha256 hex of [code, model, promptVersion]. */
  key: string;
  model: string;
  promptVersion: string;
  /** ISO date; informative only. */
  createdAt: string;
  /** Lines RELATIVE to the node, already filtered. */
  result: Explanation;
}

export interface ExplainCache {
  get(key: string): Promise<CacheEntry | undefined>;
  set(entry: CacheEntry): Promise<void>;
}

/** One JSON file per key in `dir`; atomic write (temp file + rename) (CORE-18). */
export function createDiskCache(dir: string): ExplainCache {
  const fileOf = (key: string) => join(dir, `${key}.json`);
  return {
    async get(key) {
      try {
        const entry = JSON.parse(await readFile(fileOf(key), "utf8"));
        return entry?.schemaVersion === 1 ? (entry as CacheEntry) : undefined;
      } catch {
        // Missing or corrupted file: treated as absent.
        return undefined;
      }
    },
    async set(entry) {
      await mkdir(dir, { recursive: true });
      const tmp = join(dir, `${entry.key}.${randomUUID()}.tmp`);
      await writeFile(tmp, JSON.stringify(entry), "utf8");
      await rename(tmp, fileOf(entry.key));
    },
  };
}
