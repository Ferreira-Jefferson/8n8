import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import type { FlowEdge, LinkRequest, Offer } from "@8n8/model";
import { blobHead, type PackedFile } from "./project-pack";

// A cache on disk of what the plugins derive from each file, shared by every process that uses the same cache folder
// (the CLI and the editor). It holds derived data only (names, labels, structure, doc ranges), never the source of a file:
// the text comes from reading the folder again. Any failure turns into "no cache" and never stops a build.

/** Change it when the format of a row, or of what is cached, changes: every old row goes away. */
export const ANALYSIS_CACHE_VERSION = 2;

/** The version goes in every key too, so a process of an older version, still holding the file open, cannot write rows a newer one would read. */
const keyOf = (key: string): string => `${ANALYSIS_CACHE_VERSION}|${key}`;

/** A row that inflates past this is not one of ours: it reads as no row. The biggest file of a big project is under 1 MB. */
const MAX_ROW_BYTES = 64 * 1024 * 1024;

/** The size the cache is cut back to when it opens over this (least recently used rows go first). */
export const MAX_CACHE_BYTES = 500 * 1024 * 1024;

/** A row read more than this long ago has its last use updated, so reading does not write on every open. */
const TOUCH_AFTER_MS = 6 * 60 * 60 * 1000;

/** Rows per write transaction: another process can write between two of them. */
const WRITE_BATCH = 200;

/** One file packed, with the wires, offers and requests of the plugin that belong to it. */
export interface FileResult {
  file: PackedFile;
  imports: FlowEdge[];
  offers: Offer[];
  requests: LinkRequest[];
}

export interface AnalysisCache {
  /** The text of each cached contribution, `undefined` for the keys with no good row. */
  contributions(keys: string[]): (string | undefined)[];
  /** The result under a key, with the blob made again from `source`; `undefined` with no good row. */
  result(key: string, source: string): FileResult | undefined;
  putContribution(key: string, text: string): void;
  /** Keeps its own copy of what it needs, so the blob can move to another thread afterwards. */
  putResult(key: string, result: FileResult): void;
  /** Writes what the puts queued, and the last use of the rows that were read. */
  flush(): void;
  close(): void;
}

export interface CacheOptions {
  /** Defaults to `MAX_CACHE_BYTES`. */
  maxBytes?: number;
  /** Defaults to `Date.now`. */
  now?: () => number;
}

const KIND_CONTRIBUTION = 1;
const KIND_RESULT = 2;

const SCHEMA = `
CREATE TABLE entries (
  key TEXT PRIMARY KEY,
  kind INTEGER NOT NULL,
  size INTEGER NOT NULL,
  used INTEGER NOT NULL,
  sum TEXT NOT NULL,
  head BLOB NOT NULL,
  tail BLOB
) WITHOUT ROWID;
CREATE INDEX entries_used ON entries (used, size);
CREATE TABLE info (name TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
`;

/** The sum that proves a row came out as it went in. */
const sumOf = (head: Uint8Array, tail: Uint8Array | null): string => {
  const hash = createHash("sha1").update(head);
  if (tail) hash.update(tail);
  return hash.digest("hex");
};

/** The piece of a `FileResult` that is not the blob. */
type ResultMeta = Omit<FileResult, "file"> & {
  file: Omit<PackedFile, "blob">;
};

interface Row {
  kind: number;
  used: number;
  sum: string;
  head: Uint8Array;
  tail: Uint8Array | null;
}

/** A row to write; `make` serializes it when its batch is written, not when it is queued. */
interface Queued {
  key: string;
  kind: number;
  make(): { head: Uint8Array; tail: Uint8Array | null };
}

/** The file of the cache: only the user may read it, where the system has such a thing. */
function createPrivately(file: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  closeSync(openSync(file, "a", 0o600));
}

/**
 * Opens the cache file, or makes it. Returns `undefined` when it cannot (unreadable, no permission,
 * read-only folder): the build goes on without cache. A file of another version is emptied.
 */
export function openAnalysisCache(
  file: string,
  options: CacheOptions = {},
): AnalysisCache | undefined {
  const now = options.now ?? Date.now;
  const maxBytes = options.maxBytes ?? MAX_CACHE_BYTES;
  let db: DatabaseSync;
  try {
    createPrivately(file);
    db = new DatabaseSync(file);
  } catch {
    return undefined;
  }
  try {
    // Two processes may use the file: wait for the other one to finish its write.
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    prepare(db);
    cutBack(db, maxBytes);
  } catch {
    // A file that is not a database, or one that cannot be changed: make no cache of it.
    try {
      db.close();
    } catch {
      // Nothing left to do.
    }
    return undefined;
  }

  let broken = false;
  const queue: Queued[] = [];
  const read = new Map<string, number>();
  const find = db.prepare(
    "SELECT kind, used, sum, head, tail FROM entries WHERE key = ?",
  );
  const insert = db.prepare(
    "INSERT OR REPLACE INTO entries (key, kind, size, used, sum, head, tail) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const touch = db.prepare(
    "UPDATE entries SET used = ? WHERE key = ? AND used < ?",
  );

  /** The row of a key, whole and unchanged, or `undefined`. */
  function get(key: string, kind: number): Row | undefined {
    if (broken) return undefined;
    try {
      const row = find.get(key) as Row | undefined;
      if (row === undefined || row.kind !== kind) return undefined;
      if (row.sum !== sumOf(row.head, row.tail)) return undefined;
      read.set(key, row.used);
      return row;
    } catch {
      broken = true;
      return undefined;
    }
  }

  return {
    contributions: (keys) =>
      keys.map((key) => {
        const row = get(keyOf(key), KIND_CONTRIBUTION);
        return row === undefined
          ? undefined
          : Buffer.from(row.head).toString("utf8");
      }),
    result(key, source) {
      const row = get(keyOf(key), KIND_RESULT);
      if (row?.tail == null) return undefined;
      try {
        const meta = JSON.parse(
          gunzipSync(row.head, { maxOutputLength: MAX_ROW_BYTES }).toString(
            "utf8",
          ),
        ) as ResultMeta;
        const first = blobHead(source);
        const blob = new Uint8Array(first.length + row.tail.length);
        blob.set(first);
        blob.set(row.tail, first.length);
        return {
          ...meta,
          file: { ...meta.file, blob, headBytes: first.length },
        };
      } catch {
        // A row that does not read: the file is analyzed again, and the new row takes its place.
        return undefined;
      }
    },
    putContribution(key, text) {
      queue.push({
        key: keyOf(key),
        kind: KIND_CONTRIBUTION,
        make: () => ({ head: Buffer.from(text, "utf8"), tail: null }),
      });
    },
    putResult(key, { file, imports, offers, requests }) {
      const { blob, ...rest } = file;
      const meta: ResultMeta = { file: rest, imports, offers, requests };
      // The copy stays here when the blob moves to another thread.
      const tail = blob.slice(file.headBytes);
      queue.push({
        key: keyOf(key),
        kind: KIND_RESULT,
        make: () => ({
          head: new Uint8Array(gzipSync(JSON.stringify(meta), { level: 1 })),
          tail,
        }),
      });
    },
    flush() {
      if (broken) return;
      try {
        const stamp = now();
        for (let i = 0; i < queue.length; i += WRITE_BATCH) {
          write(db, insert, queue.slice(i, i + WRITE_BATCH), stamp);
        }
        queue.length = 0;
        const stale = [...read].filter(
          ([, used]) => used < stamp - TOUCH_AFTER_MS,
        );
        read.clear();
        for (let i = 0; i < stale.length; i += WRITE_BATCH) {
          db.exec("BEGIN IMMEDIATE");
          try {
            for (const [key] of stale.slice(i, i + WRITE_BATCH)) {
              touch.run(stamp, key, stamp);
            }
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
        }
      } catch {
        // The other process holds the file, or the disk is full: the build already has its answer.
        queue.length = 0;
        broken = true;
      }
    },
    close() {
      try {
        db.close();
      } catch {
        // Closed already.
      }
    },
  };
}

function write(
  db: DatabaseSync,
  insert: StatementSync,
  rows: Queued[],
  stamp: number,
): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { key, kind, make } of rows) {
      const { head, tail } = make();
      insert.run(
        key,
        kind,
        head.length + (tail?.length ?? 0),
        stamp,
        sumOf(head, tail),
        head,
        tail,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Makes the tables, or empties the ones of another version. */
function prepare(db: DatabaseSync): void {
  const version = String(ANALYSIS_CACHE_VERSION);
  let found: string | undefined;
  try {
    found = (
      db.prepare("SELECT value FROM info WHERE name = 'version'").get() as
        | { value: string }
        | undefined
    )?.value;
  } catch {
    found = undefined;
  }
  if (found === version) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DROP TABLE IF EXISTS entries");
    db.exec("DROP TABLE IF EXISTS info");
    db.exec(SCHEMA);
    db.prepare("INSERT INTO info (name, value) VALUES ('version', ?)").run(
      version,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Over the limit, drops the least recently used rows down to 80% of it, so the next open does not do it again. */
function cutBack(db: DatabaseSync, maxBytes: number): void {
  const { total } = db
    .prepare("SELECT COALESCE(SUM(size), 0) AS total FROM entries")
    .get() as { total: number };
  if (total <= maxBytes) return;
  const goal = maxBytes * 0.8;
  const oldest = db
    .prepare("SELECT key, size FROM entries ORDER BY used, key")
    .all() as { key: string; size: number }[];
  const drop = db.prepare("DELETE FROM entries WHERE key = ?");
  let left = total;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { key, size } of oldest) {
      if (left <= goal) break;
      drop.run(key);
      left -= size;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
