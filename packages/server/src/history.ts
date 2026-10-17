import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import type { Graph, HistoryEntry, HistoryItem, ProjectData } from "@8n8/model";
import { lineCount } from "./project-compact";
import type { ProjectCounts } from "./project-store";

export { lineCount };

/**
 * A map as it was made: the history keeps only its path or its text, and the sizes. A project comes
 * with its sizes already counted (the builder counts them), or with the whole response to count here.
 */
export type MadeMap =
  | { kind: "snippet"; source: string; graph: Graph }
  | { kind: "project"; root: string; name: string; counts: ProjectCounts }
  | { kind: "project"; root: string; response: ProjectData };

export interface History {
  /** Inserts the map, or, when the same folder or snippet is already saved, bumps its opened_at and open_count. */
  save(map: MadeMap): void;
  list(): HistoryItem[];
  get(id: number): HistoryEntry | undefined;
  /** Marks or unmarks the entry as a favourite; false when the id is unknown. */
  star(id: number, starred: boolean): boolean;
  remove(id: number): boolean;
  close(): void;
}

const KEEP = 100;
const SCHEMA_VERSION = 3;

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

const ungz = (blob: Uint8Array) =>
  JSON.parse(gunzipSync(blob).toString("utf8")) as unknown;

/**
 * The key of a row: a folder is its path, so a folder has one row however its code
 * changes. A snippet is its text and language; Python adds no tag, so rows saved before
 * multi-language keep their key (5.5, 5.6).
 */
function keyOf(
  kind: "snippet" | "project",
  root: string,
  source?: string,
): string {
  const hash = createHash("sha256").update(kind).update("\0").update(root);
  if (source !== undefined) hash.update("\0").update(source);
  return hash.digest("hex");
}

const snippetTag = (language: string) =>
  language === "python" ? "" : `language:${language}`;

/**
 * v3: the history keeps only the path of a folder and the text of a snippet (CLEAN-08, CLEAN-10).
 * The stored code and graphs go; a folder saved many times keeps its latest row, starred
 * if any of its rows was.
 */
function migrateV3(db: DatabaseSync): void {
  db.exec("ALTER TABLE search ADD COLUMN source TEXT");
  db.exec("ALTER TABLE search ADD COLUMN language TEXT");
  const snippets = db
    .prepare(
      "SELECT s.id, d.graph, d.files FROM search s JOIN search_data d ON d.search_id = s.id WHERE s.kind = 'snippet'",
    )
    .all() as { id: number; graph: Uint8Array; files: Uint8Array }[];
  const setSnippet = db.prepare(
    "UPDATE search SET source = ?, language = ?, content_hash = ? WHERE id = ?",
  );
  for (const r of snippets) {
    const { source } = ungz(r.files) as { source: string };
    const { language } = ungz(r.graph) as Graph;
    setSnippet.run(
      source,
      language,
      keyOf("snippet", snippetTag(language), source),
      r.id,
    );
  }
  // A snippet with no text left cannot open again.
  db.exec("DELETE FROM search WHERE kind = 'snippet' AND source IS NULL");
  db.exec(`
    UPDATE search SET starred = 1
    WHERE kind = 'project' AND starred = 0
      AND root IN (SELECT root FROM search WHERE kind = 'project' AND starred = 1)`);
  db.exec(`
    DELETE FROM search
    WHERE kind = 'project' AND id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY root ORDER BY opened_at DESC, id DESC) AS n
        FROM search WHERE kind = 'project'
      ) WHERE n = 1
    )`);
  const projects = db
    .prepare("SELECT id, root FROM search WHERE kind = 'project'")
    .all() as { id: number; root: string | null }[];
  const setKey = db.prepare("UPDATE search SET content_hash = ? WHERE id = ?");
  for (const r of projects) setKey.run(keyOf("project", r.root ?? ""), r.id);
  db.exec("DROP TABLE search_data");
}

/** The sizes of what was read: lines and bytes of all the code, source files, nodes and wires. */
function countsOf(map: MadeMap): ProjectCounts {
  if (map.kind === "project" && "counts" in map) return map.counts;
  const sources =
    map.kind === "snippet"
      ? [map.source]
      : map.response.files.map((f) => f.source);
  const graph = map.kind === "snippet" ? map.graph : map.response.graph;
  return {
    lines: sources.reduce((n, s) => n + lineCount(s), 0),
    bytes: sources.reduce((n, s) => n + Buffer.byteLength(s), 0),
    files: sources.length,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
  };
}

function titleOf(map: MadeMap): string {
  if (map.kind === "project") {
    return "counts" in map ? map.name : map.response.name;
  }
  const first = map.source.split(/\r?\n/).find((l) => l.trim() !== "");
  return first ? first.trim().slice(0, 60) : "Trecho";
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
      if (version < 2) db.exec(SCHEMA_V2);
      migrateV3(db);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    // The deleted code leaves the file too, not only the tables.
    if (version >= 1) db.exec("VACUUM");
  }

  // A folder's sizes and name follow its latest read; a snippet's never change.
  const upsert = db.prepare(`
    INSERT INTO search (kind, title, root, source, language, content_hash, created_at, opened_at, open_count, lines, bytes, files, nodes, edges)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT (content_hash) DO UPDATE SET
      title = excluded.title, opened_at = excluded.opened_at, open_count = open_count + 1,
      lines = excluded.lines, bytes = excluded.bytes, files = excluded.files,
      nodes = excluded.nodes, edges = excluded.edges`);
  const prune = db.prepare(
    "DELETE FROM search WHERE starred = 0 AND id NOT IN (SELECT id FROM search WHERE starred = 0 ORDER BY opened_at DESC, id DESC LIMIT ?)",
  );
  const listAll = db.prepare(
    "SELECT id, kind, title, root, created_at, opened_at, open_count, lines, bytes, files, nodes, edges, starred FROM search ORDER BY opened_at DESC, id DESC",
  );
  const entryOf = db.prepare(
    "SELECT kind, root, source, language FROM search WHERE id = ?",
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
    save(map) {
      const counts = countsOf(map);
      const key =
        map.kind === "project"
          ? keyOf("project", map.root)
          : keyOf("snippet", snippetTag(map.graph.language), map.source);
      const now = tick();
      db.exec("BEGIN");
      try {
        upsert.run(
          map.kind,
          titleOf(map),
          map.kind === "project" ? map.root : null,
          map.kind === "snippet" ? map.source : null,
          map.kind === "snippet" ? map.graph.language : null,
          key,
          now,
          now,
          counts.lines,
          counts.bytes,
          counts.files,
          counts.nodes,
          counts.edges,
        );
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
      const row = entryOf.get(id) as
        | {
            kind: "snippet" | "project";
            root: string | null;
            source: string | null;
            language: string | null;
          }
        | undefined;
      if (!row) return undefined;
      if (row.kind === "project")
        return { kind: "project", root: row.root ?? "" };
      return {
        kind: "snippet",
        source: row.source ?? "",
        language: row.language ?? "python",
      };
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
