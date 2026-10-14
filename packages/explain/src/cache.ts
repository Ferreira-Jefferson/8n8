import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Explanation, NodeId, ReviewStatus } from "@code2n8n/model";
import { z } from "zod";
import type { Fingerprint } from "./fingerprint";

export interface CacheEntryV2 {
  schemaVersion: 3;
  nodeId: NodeId;
  fingerprint: Fingerprint;
  review: ReviewStatus;
  /** ISO date; informative only. */
  createdAt: string;
  /** Every line RELATIVE to the node (CACHE-05). */
  result: Explanation;
}

export interface ExplainCache {
  get(nodeId: NodeId): Promise<CacheEntryV2 | undefined>;
  set(entry: CacheEntryV2): Promise<void>;
}

const claim = z.object({
  id: z.string(),
  text: z.string(),
  lines: z.array(z.number().int()),
});

const entrySchema = z.object({
  schemaVersion: z.literal(3),
  nodeId: z.string(),
  fingerprint: z.object({
    code: z.string(),
    neighbours: z.string(),
    provider: z.string(),
    model: z.string(),
    reviewModel: z.string(),
    promptVersion: z.string(),
    reviewerVersion: z.string(),
  }),
  review: z.enum(["full", "cut"]),
  createdAt: z.string(),
  result: z.object({
    summary: z.string(),
    sentences: z.array(claim),
    inputs: z.array(claim),
    outputs: z.array(claim),
    suggestions: z.array(
      z.object({
        id: z.string(),
        command: z.string(),
        reason: z.string(),
        line: z.number().int(),
        severity: z.enum(["alta", "media", "baixa"]),
        lines: z.array(z.number().int()),
      }),
    ),
  }),
});

/** One JSON file per node identity in `<dir>/nodes/<sha256(nodeId)>.json`; atomic write (temp file + rename) (C6). */
export function createDiskCache(dir: string): ExplainCache {
  const nodes = join(dir, "nodes");
  const fileOf = (nodeId: NodeId) =>
    join(nodes, `${createHash("sha256").update(nodeId).digest("hex")}.json`);
  return {
    async get(nodeId) {
      try {
        const raw = JSON.parse(await readFile(fileOf(nodeId), "utf8"));
        const parsed = entrySchema.safeParse(raw);
        return parsed.success ? parsed.data : undefined;
      } catch {
        // Missing or corrupted file: treated as absent (CACHE-07).
        return undefined;
      }
    },
    async set(entry) {
      await mkdir(nodes, { recursive: true });
      const tmp = join(nodes, `${randomUUID()}.tmp`);
      await writeFile(tmp, JSON.stringify(entry), "utf8");
      await rename(tmp, fileOf(entry.nodeId));
    },
  };
}
