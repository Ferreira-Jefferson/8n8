import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import type { Graph, ProjectData } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { type MadeMap, openHistory } from "../history";

const graph = (n: number, e = 0): Graph => ({
  language: "python",
  empty: n === 0,
  nodes: Array.from({ length: n }, (_, i) => ({ id: `fn:f${i}` })) as never,
  edges: Array.from({ length: e }, (_, i) => ({ id: `e${i}` })) as never,
});

const snippet = (source: string, nodes = 2): MadeMap => ({
  kind: "snippet",
  source,
  graph: graph(nodes, 1),
});

const project = (root: string, files: [string, string][]): MadeMap => ({
  kind: "project",
  root,
  response: {
    name: "loja",
    graph: graph(3, 2),
    files: files.map(([path, source]) => ({ path, source })),
    ignored: [{ path: "grande.py", reason: "too-large" }],
  } as ProjectData,
});

describe("history", () => {
  it("lists the most recently opened first", () => {
    const h = openHistory(":memory:");
    h.save(snippet("a = 1"));
    h.save(snippet("b = 2"));
    expect(h.list().map((i) => i.title)).toEqual(["b = 2", "a = 1"]);
  });

  it("the same content updates the counters, not the rows", () => {
    const h = openHistory(":memory:");
    h.save(snippet("a = 1"));
    h.save(snippet("b = 2"));
    h.save(snippet("a = 1"));
    const items = h.list();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "a = 1", openCount: 2 });
    expect(items[1]?.openCount).toBe(1);
  });

  it("titles and sizes", () => {
    const h = openHistory(":memory:");
    h.save(snippet(`\n\n   ${"x".repeat(80)}  \nresto\n`, 4));
    h.save(snippet("  \n"));
    h.save(
      project("/r/loja", [
        ["b.py", "x = 1\ny = 2\n"],
        ["a.py", "z = 3"],
      ]),
    );
    const [p, empty, long] = h.list();
    expect(p).toMatchObject({
      kind: "project",
      title: "loja",
      root: "/r/loja",
      files: 2,
      lines: 4,
      bytes: 17,
      nodes: 3,
      edges: 2,
    });
    expect(empty).toMatchObject({ title: "Trecho", files: 1, lines: 2 });
    expect(empty?.root).toBeUndefined();
    expect(long?.title).toBe("x".repeat(60));
    expect(long).toMatchObject({ nodes: 4, edges: 1, files: 1 });
  });

  it("a folder has one row per path, whatever its code; the sizes follow the latest read (CLEAN-08)", () => {
    const h = openHistory(":memory:");
    h.save(project("/r", [["a.py", "1"]]));
    h.save(snippet("x = 1"));
    h.save(
      project("/r", [
        ["a.py", "1\n2"],
        ["b.py", "3"],
      ]),
    );
    h.save(project("/outra", [["a.py", "1"]]));
    const rows = h.list();
    expect(rows.map((i) => i.root ?? i.title)).toEqual([
      "/outra",
      "/r",
      "x = 1",
    ]);
    expect(rows[1]).toMatchObject({
      openCount: 2,
      files: 2,
      lines: 3,
      bytes: 4,
    });
  });

  it("never writes the code nor the graph of a folder to the file (CLEAN-08)", () => {
    const dir = mkdtempSync(join(tmpdir(), "8n8-history-path-"));
    const path = join(dir, "history.db");
    try {
      const h = openHistory(path);
      const m = project("/r/loja", [["a.py", "segredo_do_codigo = 1"]]);
      if (m.kind === "project") {
        m.response.graph.nodes[0] = { id: "fn:marca_do_grafo" } as never;
      }
      h.save(m);
      h.close();
      for (const file of [path, `${path}-wal`]) {
        if (!existsSync(file)) continue;
        const bytes = readFileSync(file).toString("latin1");
        expect(bytes).not.toContain("segredo_do_codigo");
        expect(bytes).not.toContain("marca_do_grafo");
      }
      expect(readFileSync(path).toString("latin1")).toContain("/r/loja");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps only the 100 most recently opened", () => {
    const h = openHistory(":memory:");
    for (let i = 0; i < 105; i++) h.save(snippet(`v = ${i}`));
    const items = h.list();
    expect(items).toHaveLength(100);
    expect(items[0]?.title).toBe("v = 104");
    expect(items.at(-1)?.title).toBe("v = 5");
    expect(h.get(items[0]?.id ?? 0)).toBeDefined();
  });

  it("star marks and unmarks a row; an unknown id gives false", () => {
    const h = openHistory(":memory:");
    h.save(snippet("a = 1"));
    const id = h.list()[0]?.id ?? 0;
    expect(h.list()[0]?.starred).toBe(false);
    expect(h.star(id, true)).toBe(true);
    expect(h.list()[0]?.starred).toBe(true);
    expect(h.star(id, false)).toBe(true);
    expect(h.list()[0]?.starred).toBe(false);
    expect(h.star(999, true)).toBe(false);
  });

  it("keeps a starred row past the 100 limit, and still keeps 100 others", () => {
    const h = openHistory(":memory:");
    h.save(snippet("favorito = 1"));
    h.star(h.list()[0]?.id ?? 0, true);
    for (let i = 0; i < 105; i++) h.save(snippet(`v = ${i}`));
    const items = h.list();
    expect(items).toHaveLength(101);
    expect(items.find((i) => i.title === "favorito = 1")?.starred).toBe(true);
    expect(items.filter((i) => !i.starred).at(-1)?.title).toBe("v = 5");
  });

  it("migrates a v1 file: the saved rows stay and start unstarred", () => {
    const dir = mkdtempSync(join(tmpdir(), "8n8-history-v1-"));
    const path = join(dir, "history.db");
    try {
      const old = new DatabaseSync(path);
      old.exec(`
        CREATE TABLE search (
          id INTEGER PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, root TEXT,
          content_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
          opened_at INTEGER NOT NULL, open_count INTEGER NOT NULL DEFAULT 1,
          lines INTEGER NOT NULL, bytes INTEGER NOT NULL, files INTEGER NOT NULL,
          nodes INTEGER NOT NULL, edges INTEGER NOT NULL
        );
        CREATE TABLE search_data (
          search_id INTEGER PRIMARY KEY REFERENCES search (id) ON DELETE CASCADE,
          graph BLOB NOT NULL, files BLOB NOT NULL
        );
        INSERT INTO search VALUES (7, 'snippet', 'a = 1', NULL, 'h', 1, 1, 1, 1, 5, 1, 2, 1);
        PRAGMA user_version = 1;
      `);
      old
        .prepare("INSERT INTO search_data VALUES (7, ?, ?)")
        .run(
          gzipSync(JSON.stringify(graph(2))),
          gzipSync('{"source":"a = 1"}'),
        );
      old.close();
      const h = openHistory(path);
      expect(h.list()).toEqual([
        expect.objectContaining({ id: 7, title: "a = 1", starred: false }),
      ]);
      expect(h.star(7, true)).toBe(true);
      h.close();
      const again = openHistory(path);
      expect(again.list()[0]?.starred).toBe(true);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("remove deletes the row and its data", () => {
    const h = openHistory(":memory:");
    h.save(snippet("a = 1"));
    const id = h.list()[0]?.id ?? 0;
    expect(h.remove(id)).toBe(true);
    expect(h.remove(id)).toBe(false);
    expect(h.get(id)).toBeUndefined();
    expect(h.list()).toEqual([]);
  });

  it("get gives back only the path of a folder and the text and language of a snippet (CLEAN-08)", () => {
    const h = openHistory(":memory:");
    h.save(snippet("def f():\n    return 1\n"));
    h.save(
      project("/r/loja", [
        ["z.py", "x = 1"],
        ["a.py", "é = 2"],
      ]),
    );
    const [pb, pa] = h.list();
    expect(h.get(pa?.id ?? 0)).toEqual({
      kind: "snippet",
      source: "def f():\n    return 1\n",
      language: "python",
    });
    expect(h.get(pb?.id ?? 0)).toEqual({ kind: "project", root: "/r/loja" });
    expect(h.get(999)).toBeUndefined();
  });

  it("get does not count a visit: the re-read does", () => {
    const h = openHistory(":memory:");
    h.save(snippet("a = 1"));
    const id = h.list()[0]?.id ?? 0;
    h.get(id);
    expect(h.list()[0]?.openCount).toBe(1);
  });

  it("migrates a v2 file: drops the code and graphs, one row per folder, favourites kept (CLEAN-10)", () => {
    const dir = mkdtempSync(join(tmpdir(), "8n8-history-v2-"));
    const path = join(dir, "history.db");
    try {
      const old = new DatabaseSync(path);
      old.exec(`
        CREATE TABLE search (
          id INTEGER PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, root TEXT,
          content_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
          opened_at INTEGER NOT NULL, open_count INTEGER NOT NULL DEFAULT 1,
          lines INTEGER NOT NULL, bytes INTEGER NOT NULL, files INTEGER NOT NULL,
          nodes INTEGER NOT NULL, edges INTEGER NOT NULL,
          starred INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE search_data (
          search_id INTEGER PRIMARY KEY REFERENCES search (id) ON DELETE CASCADE,
          graph BLOB NOT NULL, files BLOB NOT NULL
        );
        INSERT INTO search VALUES (1, 'project', 'loja', '/r/loja', 'h1', 1, 10, 1, 1, 1, 1, 1, 1, 1);
        INSERT INTO search VALUES (2, 'project', 'loja', '/r/loja', 'h2', 2, 30, 1, 2, 2, 2, 2, 2, 0);
        INSERT INTO search VALUES (3, 'project', 'loja', '/r/loja', 'h3', 3, 20, 1, 3, 3, 3, 3, 3, 0);
        INSERT INTO search VALUES (4, 'project', 'app', '/r/app', 'h4', 4, 40, 1, 4, 4, 4, 4, 4, 0);
        INSERT INTO search VALUES (5, 'snippet', 'x = 1', NULL, 'h5', 5, 50, 1, 1, 5, 1, 1, 0, 1);
        INSERT INTO search VALUES (6, 'snippet', 'perdido', NULL, 'h6', 6, 60, 1, 1, 5, 1, 1, 0, 0);
        PRAGMA user_version = 2;
      `);
      const data = old.prepare("INSERT INTO search_data VALUES (?, ?, ?)");
      const files = gzipSync(
        JSON.stringify({
          name: "loja",
          files: [{ path: "a.py", source: "codigo_antigo = 1" }],
          ignored: [],
        }),
      );
      for (const id of [1, 2, 3, 4]) {
        data.run(id, gzipSync(JSON.stringify(graph(1))), files);
      }
      data.run(
        5,
        gzipSync(JSON.stringify({ ...graph(1), language: "typescript" })),
        gzipSync('{"source":"x = 1"}'),
      );
      old.close();

      const h = openHistory(path);
      // Folder rows: the latest of each path, starred because one of its rows was.
      // The snippet with no saved text cannot open again and goes.
      expect(h.list().map((i) => [i.id, i.starred])).toEqual([
        [5, true],
        [4, false],
        [2, true],
      ]);
      expect(h.get(2)).toEqual({ kind: "project", root: "/r/loja" });
      expect(h.get(5)).toEqual({
        kind: "snippet",
        source: "x = 1",
        language: "typescript",
      });
      // The same folder and the same snippet find their migrated rows.
      h.save(project("/r/loja", [["a.py", "1"]]));
      h.save({
        kind: "snippet",
        source: "x = 1",
        graph: { ...graph(1), language: "typescript" },
      });
      expect(h.list().map((i) => [i.id, i.openCount])).toEqual([
        [5, 2],
        [2, 2],
        [4, 1],
      ]);
      h.close();

      const db = new DatabaseSync(path);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all();
      expect(tables).toEqual([{ name: "search" }]);
      db.close();
      // VACUUM: the old blobs left the file, not only the table.
      expect(readFileSync(path).includes(files)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("list and get stay fast with 100 entries of a 300-file project", () => {
    const h = openHistory(":memory:");
    const body = Array.from(
      { length: 80 },
      (_, i) => `def f${i}(a, b):\n    return a + b + ${i}\n`,
    ).join("\n");
    for (let n = 0; n < 100; n++) {
      const files = Array.from({ length: 300 }, (_, i) => ({
        path: `m/f${i}.py`,
        source: `# ${n}-${i}\n${body}`,
      }));
      h.save({
        kind: "project",
        root: `/r/${n}`,
        response: {
          name: `p${n}`,
          graph: graph(3000, 4000),
          files,
          ignored: [],
        },
      });
    }
    const t0 = performance.now();
    const items = h.list();
    const tList = performance.now() - t0;
    const t1 = performance.now();
    const entry = h.get(items[0]?.id ?? 0);
    const tGet = performance.now() - t1;
    console.log(
      `history perf: list ${tList.toFixed(2)} ms, get ${tGet.toFixed(2)} ms`,
    );
    expect(items).toHaveLength(100);
    expect(entry?.kind).toBe("project");
    expect(tList).toBeLessThan(100);
    expect(tGet).toBeLessThan(500);
  }, 120_000);
});
