import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import type { Graph, HistoryEntry } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { openHistory } from "../history";

const graph = (language: string): Graph => ({
  language,
  empty: false,
  nodes: [],
  edges: [],
});

const snippet = (source: string, language: string): HistoryEntry => ({
  kind: "snippet",
  source,
  graph: graph(language),
});

/** The database as the version before multi-language wrote it: schema v2, the old hash of a snippet. */
function writeOldDatabase(path: string, source: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE search (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, root TEXT,
      content_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, opened_at INTEGER NOT NULL,
      open_count INTEGER NOT NULL DEFAULT 1, lines INTEGER NOT NULL, bytes INTEGER NOT NULL,
      files INTEGER NOT NULL, nodes INTEGER NOT NULL, edges INTEGER NOT NULL,
      starred INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE search_data (
      search_id INTEGER PRIMARY KEY REFERENCES search (id) ON DELETE CASCADE,
      graph BLOB NOT NULL, files BLOB NOT NULL
    );
    PRAGMA user_version = 2;
  `);
  // The old formula: kind, root ("" for a snippet), then each source, all joined by NUL.
  const hash = createHash("sha256")
    .update("snippet")
    .update("\0")
    .update("")
    .update("\0")
    .update(source)
    .digest("hex");
  db.prepare(
    "INSERT INTO search VALUES (1, 'snippet', ?, NULL, ?, 1, 1, 1, 1, ?, 1, 0, 0, 0)",
  ).run(source, hash, Buffer.byteLength(source));
  db.prepare("INSERT INTO search_data VALUES (1, ?, ?)").run(
    gzipSync(JSON.stringify(graph("python"))),
    gzipSync(JSON.stringify({ source })),
  );
  db.close();
}

describe("history by language (5.5, 5.6)", () => {
  it("the same text in two languages is two entries", () => {
    const h = openHistory(":memory:");
    h.save(snippet("x = 1", "python"));
    h.save(snippet("x = 1", "typescript"));
    h.save(snippet("x = 1", "typescript"));
    const items = h.list();
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.openCount).sort()).toEqual([1, 2]);
  });

  it("each entry gives back the graph of its own language", () => {
    const h = openHistory(":memory:");
    h.save(snippet("x = 1", "python"));
    h.save(snippet("x = 1", "typescript"));
    const languages = h.list().map((i) => {
      const entry = h.get(i.id);
      return entry?.kind === "snippet" ? entry.graph.language : "";
    });
    expect(languages.sort()).toEqual(["python", "typescript"]);
  });

  it("a language never meets the Python entry of the same text", () => {
    const h = openHistory(":memory:");
    h.save(snippet("a", "python"));
    h.save(snippet("a", "mixed"));
    expect(h.list()).toHaveLength(2);
  });

  it("an old database opens: its rows count as python, and the same Python snippet joins the old row", () => {
    const dir = mkdtempSync(join(tmpdir(), "8n8-oldhist-"));
    const path = join(dir, "historico.db");
    writeOldDatabase(path, "x = 1");
    const h = openHistory(path);
    try {
      const [old] = h.list();
      expect(old).toMatchObject({ id: 1, title: "x = 1", openCount: 1 });
      const entry = h.get(1);
      expect(entry?.kind === "snippet" && entry.graph.language).toBe("python");

      h.save(snippet("x = 1", "python"));
      expect(h.list()).toHaveLength(1);
      expect(h.list()[0]).toMatchObject({ id: 1, openCount: 2 });

      h.save(snippet("x = 1", "typescript"));
      expect(h.list()).toHaveLength(2);
    } finally {
      h.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
