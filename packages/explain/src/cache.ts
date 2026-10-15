import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NodeId, ReviewStatus, Suggestion, Summary } from "@8n8/model";
import { z } from "zod";
import type { Fingerprint } from "./fingerprint";

/** One cached part of a node's explanation; every line RELATIVE to the node (CACHE-05, CFG-04). */
export interface CacheEntry<T> {
  schemaVersion: 4;
  nodeId: NodeId;
  fingerprint: Fingerprint;
  review: ReviewStatus;
  /** ISO date; informative only. */
  createdAt: string;
  result: T;
}

export interface PartCache<T> {
  get(nodeId: NodeId): Promise<CacheEntry<T> | undefined>;
  set(entry: CacheEntry<T>): Promise<void>;
}

const claim = z.object({
  id: z.string(),
  text: z.string(),
  lines: z.array(z.number().int()),
});

const fingerprintSchema = z.object({
  code: z.string(),
  neighbours: z.string(),
  provider: z.string(),
  model: z.string(),
  reviewModel: z.string(),
  promptVersion: z.string(),
  reviewerVersion: z.string(),
});

const suggestionSchema = z.object({
  id: z.string(),
  command: z.string(),
  reason: z.string(),
  line: z.number().int(),
  severity: z.enum(["alta", "media", "baixa"]),
  lines: z.array(z.number().int()),
});

const summarySchema = z.object({
  summary: z.string(),
  sentences: z.array(claim),
  inputs: z.array(claim),
  outputs: z.array(claim),
});

/** One JSON file per node identity in `<dir>/<folder>/<sha256(nodeId)>.json`; atomic write (temp file + rename). Any other shape counts as absent (CACHE-07). */
function createPartCache<T>(
  dir: string,
  folder: string,
  result: z.ZodType<T>,
): PartCache<T> {
  const schema = z.object({
    schemaVersion: z.literal(4),
    nodeId: z.string(),
    fingerprint: fingerprintSchema,
    review: z.enum(["full", "cut"]),
    createdAt: z.string(),
    result,
  });
  const files = join(dir, folder);
  const fileOf = (nodeId: NodeId) =>
    join(files, `${createHash("sha256").update(nodeId).digest("hex")}.json`);
  return {
    async get(nodeId) {
      try {
        const raw = JSON.parse(await readFile(fileOf(nodeId), "utf8"));
        const parsed = schema.safeParse(raw);
        return parsed.success ? (parsed.data as CacheEntry<T>) : undefined;
      } catch {
        // Missing or corrupted file: treated as absent (CACHE-07).
        return undefined;
      }
    },
    async set(entry) {
      await mkdir(files, { recursive: true });
      const tmp = join(files, `${randomUUID()}.tmp`);
      await writeFile(tmp, JSON.stringify(entry), "utf8");
      await rename(tmp, fileOf(entry.nodeId));
    },
  };
}

/** The summaries, in `<dir>/nodes` (CFG-04). */
export function createSummaryCache(dir: string): PartCache<Summary> {
  return createPartCache(dir, "nodes", summarySchema);
}

/** The suggestions, in `<dir>/suggestions` (CFG-04). */
export function createSuggestionsCache(dir: string): PartCache<Suggestion[]> {
  return createPartCache(dir, "suggestions", z.array(suggestionSchema));
}
