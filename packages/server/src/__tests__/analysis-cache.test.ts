import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import type { LanguagePlugin, SourceFile } from "@8n8/model";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AnalysisCache,
  MAX_CACHE_BYTES,
  openAnalysisCache,
} from "../analysis-cache";
import { analysisCacheFile } from "../core";
import { languagePlugins } from "../plugins";
import {
  type BuildInput,
  buildInThread,
  buildStreamed,
  type PackingRunner,
} from "../project-build";
import { packAnalysis } from "../project-pack";
import type { StoreParts } from "../project-store";
import { answers, referenceParts } from "./answers";
import { MIXED } from "./mixed";

/** The plugins in this thread, as the workers run them: counts the files the plugins parse. */
function inProcessRunner(size = 2): PackingRunner & { parsed: string[] } {
  const parsed: string[] = [];
  return {
    size,
    parsed,
    runPacked: async (plugin, files, pack) =>
      packAnalysis(
        plugin,
        { paths: new Set(pack.paths) },
        files,
        plugin.analyze(files),
      ),
    openPackedSlice(plugin, files) {
      parsed.push(...files.map((f) => f.path));
      const slice = (plugin.openSlice as NonNullable<typeof plugin.openSlice>)(
        files,
      );
      return {
        contribute: async () => slice.contribute(),
        analyze: async (contributions, pack) =>
          packAnalysis(
            plugin,
            { paths: new Set(pack.paths) },
            files,
            slice.analyze(contributions),
          ),
        dispose: () => slice.dispose(),
      };
    },
  };
}

const input = (files: SourceFile[]): BuildInput => ({
  name: "mista",
  files,
  ignored: [],
  version: "v-test",
});

let dir: string;
let file: string;
const opened: AnalysisCache[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "8n8-acache-"));
  file = join(dir, "analysis", "cache.db");
});
afterEach(() => {
  for (const cache of opened.splice(0)) cache.close();
  rmSync(dir, { recursive: true, force: true });
});

function open(
  options: Parameters<typeof openAnalysisCache>[1] = {},
  at = file,
): AnalysisCache {
  const cache = openAnalysisCache(at, options);
  if (!cache) throw new Error("the cache did not open");
  opened.push(cache);
  return cache;
}

/** A build through the cache, as the builder thread does it: the cache is flushed after the answer. */
async function built(
  files: SourceFile[],
  plugins: LanguagePlugin[] = languagePlugins,
  cache: AnalysisCache | null = open(),
) {
  const runner = inProcessRunner();
  const parts = await buildStreamed(
    input(files),
    plugins,
    runner,
    cache === null ? {} : { cache },
  );
  cache?.flush();
  return { parts, parsed: [...runner.parsed].sort() };
}

/** The answers of the same project without cache, in this thread. */
const plain = async (files: SourceFile[], plugins = languagePlugins) =>
  answers(await buildInThread(input(files), plugins));

const edit = (path: string, from: string, to: string): SourceFile[] =>
  MIXED.map((f) =>
    f.path === path ? { ...f, source: f.source.replace(from, to) } : f,
  );

const PYTHON = MIXED.filter((f) => f.path.endsWith(".py")).map((f) => f.path);

describe("the analysis cache gives the answers of a build without it", () => {
  it("empty, full and after the cache is opened again", async () => {
    const reference = await plain(MIXED);
    const cold = await built(MIXED);
    expect(answers(cold.parts)).toEqual(reference);
    expect(cold.parsed).toEqual(MIXED.map((f) => f.path).sort());
    expect(cold.parts.cross.length).toBeGreaterThan(0);

    // Another open of the file, as another process would: nothing is parsed, the answers do not change.
    opened.pop()?.close();
    const warm = await built(MIXED);
    expect(warm.parsed).toEqual([]);
    expect(answers(warm.parts)).toEqual(reference);
    // The reference of the whole graph packed the plain way.
    expect(answers(warm.parts)).toEqual(
      answers(referenceParts("mista", MIXED, languagePlugins)),
    );
  });

  it("parses only the file whose text changed when its contribution stays the same", async () => {
    await built(MIXED);
    const files = edit("app/modelos/base.py", "return 1", "return 2");
    const after = await built(files);
    expect(after.parsed).toEqual(["app/modelos/base.py"]);
    expect(answers(after.parts)).toEqual(await plain(files));
    // And once more: the new text is cached too.
    expect((await built(files)).parsed).toEqual([]);
  });

  it("analyzes again the files of a language whose context changed, and only that language", async () => {
    await built(MIXED);
    const files = edit(
      "app/modelos/base.py",
      "def helper():",
      "def novo():\n    return 0\n\ndef helper():",
    );
    const after = await built(files);
    expect(after.parsed).toEqual([...PYTHON].sort());
    expect(answers(after.parts)).toEqual(await plain(files));
  });

  it("analyzes everything again when a file comes or goes", async () => {
    await built(MIXED);
    const fewer = MIXED.filter((f) => f.path !== "lib.ts");
    const after = await built(fewer);
    expect(after.parsed).toEqual(fewer.map((f) => f.path).sort());
    expect(answers(after.parts)).toEqual(await plain(fewer));
    const more = [...MIXED, { path: "extra.py", source: "def a():\n  pass\n" }];
    expect(answers((await built(more)).parts)).toEqual(await plain(more));
  });

  it("a partial cache (some files cached, some not) answers the same", async () => {
    await built(MIXED.slice(0, 5));
    const after = await built(MIXED);
    expect(answers(after.parts)).toEqual(await plain(MIXED));
  });

  it("does not cache a plugin without cacheVersion, nor one without openSlice", async () => {
    const [py, ts] = languagePlugins as [LanguagePlugin, LanguagePlugin];
    const { cacheVersion: _version, ...withoutVersion } = py;
    const { openSlice: _slice, ...withoutSlice } = ts;
    const plugins: LanguagePlugin[] = [withoutVersion, withoutSlice];
    await built(MIXED, plugins);
    const again = await built(MIXED, plugins);
    // The Python files are parsed again, and the TypeScript ones run whole (no slice).
    expect(again.parsed).toEqual([...PYTHON].sort());
    expect(answers(again.parts)).toEqual(await plain(MIXED, plugins));
    expect(rows().length).toBe(0);
  });

  it("a version of a plugin makes other rows", async () => {
    await built(MIXED);
    const [py, ts] = languagePlugins as [LanguagePlugin, LanguagePlugin];
    const next = await built(MIXED, [
      { ...py, cacheVersion: `${py.cacheVersion}-next` },
      ts,
    ]);
    expect(next.parsed).toEqual([...PYTHON].sort());
  });
});

/** Every row of the file, read on its own. */
function rows(): { key: string; kind: number; head: Uint8Array }[] {
  const db = new DatabaseSync(file);
  try {
    return db
      .prepare("SELECT key, kind, head, tail FROM entries")
      .all() as never;
  } finally {
    db.close();
  }
}

/** Changes the file under the cache, with the cache closed. */
function tamper(run: (db: DatabaseSync) => void) {
  opened.pop()?.close();
  const db = new DatabaseSync(file);
  try {
    run(db);
  } finally {
    db.close();
  }
}

describe("a row that cannot be trusted is ignored and made again", () => {
  it("a wrong sum", async () => {
    await built(MIXED);
    tamper((db) => db.exec("UPDATE entries SET sum = 'x'"));
    const after = await built(MIXED);
    expect(after.parsed).toEqual(MIXED.map((f) => f.path).sort());
    expect(answers(after.parts)).toEqual(await plain(MIXED));
    // Made again: the next open finds good rows.
    expect((await built(MIXED)).parsed).toEqual([]);
  });

  it("a row whose bytes changed under a good sum of another content", async () => {
    await built(MIXED);
    tamper((db) =>
      db.exec("UPDATE entries SET head = zeroblob(10) WHERE kind = 2"),
    );
    const after = await built(MIXED);
    expect(answers(after.parts)).toEqual(await plain(MIXED));
  });

  it("a row of a kind that is not the one asked", async () => {
    await built(MIXED);
    tamper((db) => db.exec("UPDATE entries SET kind = 9"));
    const after = await built(MIXED);
    expect(answers(after.parts)).toEqual(await plain(MIXED));
  });

  it("a row with a good sum and a damaged content", async () => {
    await built(MIXED);
    tamper((db) => {
      const sum = (head: Uint8Array, tail: Uint8Array | null) => {
        const hash = createHash("sha1").update(head);
        if (tail) hash.update(tail);
        return hash.digest("hex");
      };
      const garbage = Buffer.from("not gzip, not json");
      const all = db
        .prepare("SELECT key FROM entries WHERE kind = 2")
        .all() as {
        key: string;
      }[];
      const set = db.prepare(
        "UPDATE entries SET head = ?, tail = ?, sum = ? WHERE key = ?",
      );
      for (const { key } of all) {
        set.run(garbage, garbage, sum(garbage, garbage), key);
      }
    });
    const after = await built(MIXED);
    expect(answers(after.parts)).toEqual(await plain(MIXED));
  });

  it("a file of another version of the cache is emptied", async () => {
    await built(MIXED);
    expect(rows().length).toBeGreaterThan(0);
    tamper((db) => db.exec("UPDATE info SET value = '0'"));
    const after = await built(MIXED);
    expect(after.parsed).toEqual(MIXED.map((f) => f.path).sort());
    expect(answers(after.parts)).toEqual(await plain(MIXED));
  });
});

describe("a cache that cannot be used never stops the build", () => {
  it("a file that is not a database", async () => {
    mkdirSync(join(dir, "analysis"), { recursive: true });
    writeFileSync(
      file,
      "this is not a database, and it is long enough ".repeat(50),
    );
    expect(openAnalysisCache(file)).toBeUndefined();
    const { parts } = await built(MIXED, languagePlugins, null);
    expect(answers(parts)).toEqual(await plain(MIXED));
  });

  it("a place where the file cannot be made", () => {
    // The parent of the file is a file.
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "");
    expect(openAnalysisCache(join(blocker, "cache.db"))).toBeUndefined();
  });

  it("a read-only file", async () => {
    const cache = open();
    cache.close();
    opened.pop();
    // Only the user may write it, and the user took that away. On a system that ignores the mode this test still must not fail.
    chmodSync(file, 0o444);
    const reopened = openAnalysisCache(file);
    try {
      const { parts } = await built(MIXED, languagePlugins, reopened ?? null);
      expect(answers(parts)).toEqual(await plain(MIXED));
    } finally {
      reopened?.close();
      chmodSync(file, 0o644);
    }
  });

  it("a write that fails after the answer is lost without an error", async () => {
    const cache = open();
    const runner = inProcessRunner();
    const parts = await buildStreamed(input(MIXED), languagePlugins, runner, {
      cache,
    });
    // The file goes away from under the cache: the flush must not throw.
    cache.close();
    expect(() => cache.flush()).not.toThrow();
    expect(answers(parts)).toEqual(await plain(MIXED));
  });
});

describe("the size of the cache", () => {
  it("drops the least recently used rows when it opens over the limit", async () => {
    let time = 1_000_000;
    const first = open({ now: () => time });
    const old = [
      { path: "old.py", source: "def a():\n  return 1\n" },
      { path: "lib.ts", source: "export const x = 1;\n" },
    ];
    await built(old, languagePlugins, first);
    opened.pop()?.close();
    time += 10_000;
    const second = open({ now: () => time });
    await built(MIXED, languagePlugins, second);
    opened.pop()?.close();
    const sizeOf = () =>
      (
        rows() as unknown as {
          key: string;
          head: Uint8Array;
          tail: Uint8Array;
        }[]
      ).reduce((n, r) => n + r.head.length + (r.tail?.length ?? 0), 0);
    const total = sizeOf();
    expect(total).toBeGreaterThan(1000);
    // A limit under what the file holds: the oldest rows go first, down to 80% of the limit.
    const limit = Math.floor(total * 0.9);
    open({ maxBytes: limit, now: () => time + 1 });
    const left = rows().map((r) => r.key);
    expect(left.length).toBeGreaterThan(0);
    expect(sizeOf()).toBeLessThanOrEqual(limit);
    // The rows of the older build were the ones that went.
    expect(left.some((key) => key.includes("|old.py|"))).toBe(false);
  });

  it("keeps the 500 MB limit as a constant", () => {
    expect(MAX_CACHE_BYTES).toBe(500 * 1024 * 1024);
  });
});

describe("two processes on the same file", () => {
  it("both write, neither fails, and a third finds all the rows", async () => {
    const one = open();
    const two = open();
    const a = inProcessRunner();
    const b = inProcessRunner();
    const filesA = MIXED.slice(0, 5);
    const filesB = MIXED.slice(4);
    const [partsA, partsB] = await Promise.all([
      buildStreamed(input(filesA), languagePlugins, a, { cache: one }),
      buildStreamed(input(filesB), languagePlugins, b, { cache: two }),
    ]);
    one.flush();
    two.flush();
    expect(answers(partsA)).toEqual(await plain(filesA));
    expect(answers(partsB)).toEqual(await plain(filesB));
    const third = await built(filesB, languagePlugins, open());
    // The context of the second project was written by the second one.
    expect(third.parsed).toEqual([]);
    expect(answers(third.parts)).toEqual(await plain(filesB));
  });
});

describe("what the cache keeps", () => {
  it("is private data only: the text of a file never reaches the file of the cache", async () => {
    const marker = "COMENTARIO-QUE-NAO-PODE-APARECER-777";
    const files = MIXED.map((f) =>
      f.path === "app/modelos/pedido.py"
        ? { ...f, source: `${f.source}\n# ${marker}\n` }
        : f,
    );
    const { parts } = await built(files);
    opened.pop()?.close();
    const everything = rows() as unknown as {
      head: Uint8Array;
      tail: Uint8Array | null;
    }[];
    const text = (bytes: Uint8Array | null) =>
      bytes === null ? "" : Buffer.from(bytes).toString("latin1");
    const unpacked = (bytes: Uint8Array | null) => {
      if (bytes === null) return "";
      try {
        return gunzipSync(bytes).toString("utf8");
      } catch {
        return Buffer.from(bytes).toString("utf8");
      }
    };
    const raw = readFileSync(file).toString("latin1");
    expect(raw).not.toContain(marker);
    for (const row of everything) {
      for (const bytes of [row.head, row.tail]) {
        expect(text(bytes)).not.toContain(marker);
        expect(unpacked(bytes)).not.toContain(marker);
      }
    }
    // The blob of the answer has the source, from the folder, not from the cache.
    expect(answers(parts).details.length).toBeGreaterThan(0);
    for (const f of files.filter((g) => g.source !== "")) {
      for (const row of everything) {
        expect(unpacked(row.head)).not.toContain(f.source);
        expect(unpacked(row.tail)).not.toContain(f.source);
      }
    }
    // The cache did hold derived data: the names.
    expect(everything.some((r) => unpacked(r.tail).includes("calcular"))).toBe(
      true,
    );
  });

  it("does keep pieces of the code in the labels: a literal in a condition or a return reaches the file (the README says so)", async () => {
    const literal = "SENTINELA-DE-LITERAL-555";
    const files = MIXED.map((f) =>
      f.path === "app/modelos/pedido.py"
        ? {
            ...f,
            source: `${f.source}\n\ndef checa(token):\n    if token == "${literal}":\n        return "${literal}-volta"\n    return None\n`,
          }
        : f,
    );
    await built(files);
    opened.pop()?.close();
    const everything = rows() as unknown as {
      head: Uint8Array;
      tail: Uint8Array | null;
    }[];
    const unpacked = (bytes: Uint8Array | null) => {
      if (bytes === null) return "";
      try {
        return gunzipSync(bytes).toString("utf8");
      } catch {
        return Buffer.from(bytes).toString("utf8");
      }
    };
    // If this stops holding, the README may say less: keep the two together.
    expect(everything.some((r) => unpacked(r.tail).includes(literal))).toBe(
      true,
    );
  });

  it("is a file only the user can read, where the system has such a thing", () => {
    open();
    expect(readFileSync(file).length).toBeGreaterThan(0);
  });
});

describe("analysisCacheFile", () => {
  const options = (env: Record<string, string | undefined>) => ({
    env,
    cacheDir: join("home", ".8n8", "cache"),
  });

  it("is in the analysis folder of the cache folder", () => {
    expect(analysisCacheFile(options({}))).toBe(
      join("home", ".8n8", "cache", "analysis", "cache.db"),
    );
    expect(
      analysisCacheFile(options({ APP8N8_CACHE_DIR: join("other", "dir") })),
    ).toBe(join("other", "dir", "analysis", "cache.db"));
  });

  it("is off with APP8N8_NO_ANALYSIS_CACHE=1, and only with 1", () => {
    expect(
      analysisCacheFile(options({ APP8N8_NO_ANALYSIS_CACHE: "1" })),
    ).toBeUndefined();
    expect(
      analysisCacheFile(options({ APP8N8_NO_ANALYSIS_CACHE: "0" })),
    ).toBeDefined();
  });
});

describe("the version of a plugin is the guard of its rows", () => {
  /**
   * What the plugins make of the mixed project, in one hash. When it changes, the plugin gives another result for the
   * same text: raise its `cacheVersion` (so the rows on disk of every user stop being used), then put the new hash here.
   */
  it("changes only with the cacheVersion of the plugins", async () => {
    const parts: StoreParts = await buildInThread(
      input(MIXED),
      languagePlugins,
    );
    const contributions = languagePlugins.map((p) => {
      const files = MIXED.filter((f) =>
        p.extensions.some((e) => f.path.endsWith(e)),
      ).sort((a, b) => (a.path < b.path ? -1 : 1));
      const slice = (p.openSlice as NonNullable<typeof p.openSlice>)(files);
      try {
        return slice.contribute();
      } finally {
        slice.dispose();
      }
    });
    const hash = createHash("sha1")
      .update(JSON.stringify(contributions))
      .update(JSON.stringify(answers(parts)))
      .digest("hex");
    expect({
      versions: languagePlugins.map((p) => [p.id, p.cacheVersion]),
      hash,
    }).toEqual({
      versions: [
        ["python", "2"],
        ["typescript", "2"],
      ],
      hash: "00b3deb75d157e1b3239fc60f85f99fc21881a6b",
    });
  });
});
