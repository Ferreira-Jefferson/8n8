import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import type {
  Graph,
  HistoryEntry,
  HistoryItem,
  ProjectResponse,
} from "@8n8/model";

export interface History {
  /** Inserts the map, or, when the same content is already saved, bumps its opened_at and open_count. */
  save(entry: HistoryEntry): void;
  list(): HistoryItem[];
  get(id: number): HistoryEntry | undefined;
  /** Marks the entry as opened now. */
  touch(id: number): void;
  /** Marks or unmarks the entry as a favourite; false when the id is unknown. */
  star(id: number, starred: boolean): boolean;
  remove(id: number): boolean;
  close(): void;
}

const KEEP = 100;
const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE search (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  root TEXT,
  content_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  opened_at INTEGER NOT NULL,
  open_count INTEGER NOT NULL DEFAULT 1,
  lines INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  files INTEGER NOT NULL,
  nodes INTEGER NOT NULL,
  edges INTEGER NOT NULL
);
CREATE INDEX search_opened_at ON search (opened_at DESC);
CREATE TABLE search_data (
  search_id INTEGER PRIMARY KEY REFERENCES search (id) ON DELETE CASCADE,
  graph BLOB NOT NULL,
  files BLOB NOT NULL
);
`;

// v2: favourites. A starred row escapes the KEEP limit.
const SCHEMA_V2 =
  "ALTER TABLE search ADD COLUMN starred INTEGER NOT NULL DEFAULT 0";

interface Row {
  id: number;
  kind: "snippet" | "project";
  title: string;
  root: string | null;
  created_at: number;
  opened_at: number;
  open_count: number;
  lines: number;
  bytes: number;
  files: number;
  nodes: number;
  edges: number;
  starred: number;
}

const gz = (value: unknown) => gzipSync(JSON.stringify(value));
const ungz = (blob: Uint8Array) =>
  JSON.parse(gunzipSync(blob).toString("utf8")) as unknown;

/** The source texts of an entry, in path order (the content hash input). */
function sourcesOf(entry: HistoryEntry): string[] {
  if (entry.kind === "snippet") return [entry.source];
  return [...entry.response.files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => f.source);
}

/**
 * What a snippet adds to its content hash: its language, so the same text in two languages
 * is two entries. Python adds nothing: rows saved before multi-language have the hash of
 * a Python snippet, so they count as `python` and the same snippet finds them (5.5, 5.6).
 */
function snippetTag(entry: HistoryEntry): string {
  if (entry.kind !== "snippet" || entry.graph.language === "python") return "";
  return `language:${entry.graph.language}`;
}

/** What goes in `search_data.files`: everything but the graph, in its original order. */
function filesBlobOf(entry: HistoryEntry): unknown {
  if (entry.kind === "snippet") return { source: entry.source };
  const { name, files, ignored } = entry.response;
  return { name, files, ignored };
}

function titleOf(entry: HistoryEntry): string {
  if (entry.kind === "project") return entry.response.name;
  const first = entry.source.split(/\r?\n/).find((l) => l.trim() !== "");
  return first ? first.trim().slice(0, 60) : "Trecho";
}

function graphOf(entry: HistoryEntry): Graph {
  return entry.kind === "snippet" ? entry.graph : entry.response.graph;
}

function toItem(r: Row): HistoryItem {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    ...(r.root === null ? {} : { root: r.root }),
    createdAt: r.created_at,
    openedAt: r.opened_at,
    openCount: r.open_count,
    lines: r.lines,
    bytes: r.bytes,
    files: r.files,
    nodes: r.nodes,
    edges: r.edges,
    starred: r.starred === 1,
  };
}

/** Opens (and migrates) the history database: a file path, or ":memory:". */
export function openHistory(path: string): History {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  const version = (
    db.prepare("PRAGMA user_version").get() as { user_version: number }
  ).user_version;
  if (version < SCHEMA_VERSION) {
    db.exec("BEGIN");
    try {
      if (version < 1) db.exec(SCHEMA);
      db.exec(SCHEMA_V2);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  const upsert = db.prepare(`
    INSERT INTO search (kind, title, root, content_hash, created_at, opened_at, open_count, lines, bytes, files, nodes, edges)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT (content_hash) DO UPDATE SET opened_at = excluded.opened_at, open_count = open_count + 1
    RETURNING id, created_at`);
  const insertData = db.prepare(
    "INSERT OR IGNORE INTO search_data (search_id, graph, files) VALUES (?, ?, ?)",
  );
  const prune = db.prepare(
    "DELETE FROM search WHERE starred = 0 AND id NOT IN (SELECT id FROM search WHERE starred = 0 ORDER BY opened_at DESC, id DESC LIMIT ?)",
  );
  const listAll = db.prepare(
    "SELECT id, kind, title, root, created_at, opened_at, open_count, lines, bytes, files, nodes, edges, starred FROM search ORDER BY opened_at DESC, id DESC",
  );
  const kindOf = db.prepare("SELECT kind, root FROM search WHERE id = ?");
  const dataOf = db.prepare(
    "SELECT graph, files FROM search_data WHERE search_id = ?",
  );
  const touchRow = db.prepare(
    "UPDATE search SET opened_at = ?, open_count = open_count + 1 WHERE id = ?",
  );
  const starRow = db.prepare("UPDATE search SET starred = ? WHERE id = ?");
  const del = db.prepare("DELETE FROM search WHERE id = ?");

  // Strictly increasing, so two saves in the same millisecond still keep their order.
  let last = 0;
  const tick = () => {
    last = Math.max(Date.now(), last + 1);
    return last;
  };

  return {
    save(entry) {
      const sources = sourcesOf(entry);
      const root = entry.kind === "project" ? entry.root : snippetTag(entry);
      const hash = createHash("sha256")
        .update(entry.kind)
        .update("\0")
        .update(root);
      for (const s of sources) hash.update("\0").update(s);
      const graph = graphOf(entry);
      const code = sources;
      const lines = code.reduce(
        (n, s) => n + (s === "" ? 0 : s.split(/\r?\n/).length),
        0,
      );
      const bytes = code.reduce((n, s) => n + Buffer.byteLength(s), 0);
      const now = tick();
      // Blobs are compressed before the transaction: the write lock is held for the SQL only.
      const blobs = [gz(graph), gz(filesBlobOf(entry))];
      db.exec("BEGIN");
      try {
        const row = upsert.get(
          entry.kind,
          titleOf(entry),
          entry.kind === "project" ? entry.root : null,
          hash.digest("hex"),
          now,
          now,
          lines,
          bytes,
          entry.kind === "snippet" ? 1 : entry.response.files.length,
          graph.nodes.length,
          graph.edges.length,
        ) as { id: number };
        insertData.run(row.id, blobs[0] as Buffer, blobs[1] as Buffer);
        prune.run(KEEP);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    list() {
      return (listAll.all() as unknown as Row[]).map(toItem);
    },
    get(id) {
      const head = kindOf.get(id) as
        | { kind: "snippet" | "project"; root: string | null }
        | undefined;
      const data = dataOf.get(id) as
        | { graph: Uint8Array; files: Uint8Array }
        | undefined;
      if (!head || !data) return undefined;
      const graph = ungz(data.graph) as Graph;
      const rest = ungz(data.files) as
        | { source: string }
        | Pick<ProjectResponse, "name" | "files" | "ignored">;
      if (head.kind === "snippet") {
        return {
          kind: "snippet",
          source: (rest as { source: string }).source,
          graph,
        };
      }
      const { name, files, ignored } = rest as Pick<
        ProjectResponse,
        "name" | "files" | "ignored"
      >;
      return {
        kind: "project",
        root: head.root ?? "",
        response: { name, graph, files, ignored },
      };
    },
    touch(id) {
      touchRow.run(tick(), id);
    },
    star(id, starred) {
      return Number(starRow.run(starred ? 1 : 0, id).changes) > 0;
    },
    remove(id) {
      return Number(del.run(id).changes) > 0;
    },
    close() {
      db.close();
    },
  };
}
