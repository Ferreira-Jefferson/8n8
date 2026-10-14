import type { Graph, HistoryEntry, ProjectResponse } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { openHistory } from "../history";

const graph = (n: number, e = 0): Graph => ({
  language: "python",
  empty: n === 0,
  nodes: Array.from({ length: n }, (_, i) => ({ id: `fn:f${i}` })) as never,
  edges: Array.from({ length: e }, (_, i) => ({ id: `e${i}` })) as never,
});

const snippet = (source: string, nodes = 2): HistoryEntry => ({
  kind: "snippet",
  source,
  graph: graph(nodes, 1),
});

const project = (root: string, files: [string, string][]): HistoryEntry => ({
  kind: "project",
  root,
  response: {
    name: "loja",
    graph: graph(3, 2),
    files: files.map(([path, source]) => ({ path, source })),
    ignored: [{ path: "grande.py", reason: "too-large" }],
  } as ProjectResponse,
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

  it("the project hash does not depend on the order of the files", () => {
    const h = openHistory(":memory:");
    h.save(
      project("/r", [
        ["a.py", "1"],
        ["b.py", "2"],
      ]),
    );
    h.save(
      project("/r", [
        ["b.py", "2"],
        ["a.py", "1"],
      ]),
    );
    expect(h.list()).toHaveLength(1);
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

  it("remove deletes the row and its data", () => {
    const h = openHistory(":memory:");
    h.save(snippet("a = 1"));
    const id = h.list()[0]?.id ?? 0;
    expect(h.remove(id)).toBe(true);
    expect(h.remove(id)).toBe(false);
    expect(h.get(id)).toBeUndefined();
    expect(h.list()).toEqual([]);
  });

  it("get returns the saved entry, deeply equal", () => {
    const h = openHistory(":memory:");
    const a = snippet("def f():\n    return 1\n");
    const b = project("/r/loja", [
      ["z.py", "x = 1"],
      ["a.py", "é = 2"],
    ]);
    h.save(a);
    h.save(b);
    const [pb, pa] = h.list();
    expect(h.get(pa?.id ?? 0)).toEqual(a);
    expect(h.get(pb?.id ?? 0)).toEqual(b);
    expect(h.get(999)).toBeUndefined();
  });

  it("touch bumps opened_at and open_count, get does not", async () => {
    const h = openHistory(":memory:");
    h.save(snippet("a = 1"));
    h.save(snippet("b = 2"));
    const first = h.list()[1];
    const id = first?.id ?? 0;
    h.get(id);
    expect(h.list()[1]?.openCount).toBe(1);
    await new Promise((r) => setTimeout(r, 5));
    h.touch(id);
    const items = h.list();
    expect(items[0]).toMatchObject({ id, openCount: 2 });
    expect(items[0]?.openedAt).toBeGreaterThan(first?.openedAt ?? 0);
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
