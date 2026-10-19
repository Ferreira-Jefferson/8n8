import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceFile } from "@8n8/model";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openAnalysisCache } from "../analysis-cache";
import { composeBuild } from "../core";
import { languagePlugins } from "../plugins";
import { type BuildInput, buildInThread } from "../project-build";
import { createProjectBuilder, type ProjectBuilder } from "../project-builder";
import type { StoreParts } from "../project-store";
import { answers, referenceParts } from "./answers";
import { MIXED } from "./mixed";

// Starting a worker thread that reads TypeScript through tsx takes seconds on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const WORKER = fileURLToPath(new URL("../analysis-worker.ts", import.meta.url));
// The worker runs from source here: tsx reads the TypeScript and the workspace packages.
const execArgv = ["--import", "tsx"];

const FILES: SourceFile[] = [
  {
    path: "app/cliente.py",
    source:
      'import requests\n\ndef pedir():\n    return requests.post("http://localhost:3000/api/frete")\n\ndef conta(itens):\n    return somar(itens)\n',
  },
  {
    path: "api/servidor.ts",
    source:
      'const app = new Hono();\napp.post("/api/frete", (c) => c.json({ valor: calcular(10) }));\nfunction calcular(n: number) { return n; }\n',
  },
  {
    path: "lib.ts",
    source:
      "export function somar(itens: number[]): number {\n  return 0;\n}\n",
  },
];
const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");
const input = (files = FILES): BuildInput => ({
  name: "mista",
  files,
  ignored: [{ path: "grande.py", reason: "too-large", addable: true }],
  version: "v-1",
});

let builder: ProjectBuilder | undefined;
afterEach(async () => {
  await builder?.close();
  builder = undefined;
});

describe("createProjectBuilder", () => {
  it("builds in a worker thread what the plain packing of the whole graph gives, for Python and TypeScript linked to each other", async () => {
    builder = createProjectBuilder({ worker: WORKER, execArgv });
    const built = await builder.build({
      name: "mista",
      files: MIXED,
      ignored: [],
      version: "v-test",
    });
    expect(answers(built)).toEqual(
      answers(referenceParts("mista", MIXED, languagePlugins)),
    );
    expect(built.cross.length).toBeGreaterThan(0);
  });

  it("builds in a worker thread what the thread of the request would build", async () => {
    builder = createProjectBuilder({ worker: WORKER, execArgv });
    const inThread = await buildInThread(input(), languagePlugins);
    const inWorker = await builder.build(input());
    expect(answers(inWorker)).toEqual(answers(inThread));
    expect(inWorker.cross.length).toBeGreaterThan(0);
  });

  it("keeps the work of each file in the file of the cache, and builds the same answers cold and warm", async () => {
    const dir = mkdtempSync(join(tmpdir(), "8n8-builder-cache-"));
    try {
      const cacheFile = join(dir, "analysis", "cache.db");
      builder = createProjectBuilder({ worker: WORKER, execArgv, cacheFile });
      const reference = answers(
        referenceParts("mista", MIXED, languagePlugins),
      );
      const build = () =>
        builder?.build({
          name: "mista",
          files: MIXED,
          ignored: [],
          version: "v-test",
        }) as Promise<StoreParts>;
      expect(answers(await build())).toEqual(reference);
      // The thread writes after it answers.
      const rowCount = () => {
        const cache = openAnalysisCache(cacheFile);
        if (!cache) return 0;
        const found = cache.contributions(
          MIXED.map((f) => `python|2|${f.path}|${sha1(f.source)}`),
        );
        cache.close();
        return found.filter((text) => text !== undefined).length;
      };
      for (let i = 0; i < 100 && rowCount() === 0; i++) {
        await new Promise((go) => setTimeout(go, 100));
      }
      expect(rowCount()).toBeGreaterThan(0);
      expect(answers(await build())).toEqual(reference);
    } finally {
      await builder?.close();
      builder = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds again with the same thread, one after the other", async () => {
    builder = createProjectBuilder({ worker: WORKER, execArgv });
    const [one, two] = await Promise.all([
      builder.build(input()),
      builder.build(input(FILES.slice(0, 1))),
    ]);
    expect(one.counts.files).toBe(3);
    expect(two.counts.files).toBe(1);
  });

  it("rejects what a thread that stops owed, and starts another one for the next build", async () => {
    const dir = mkdtempSync(join(tmpdir(), "8n8-builder-"));
    try {
      const crash = join(dir, "crash.mjs");
      writeFileSync(crash, "process.exit(3);\n");
      builder = createProjectBuilder({ worker: crash });
      await expect(builder.build(input())).rejects.toThrow(/stopped/);
      await expect(builder.build(input())).rejects.toThrow(/stopped/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects the build of a closed builder instead of leaving it pending", async () => {
    builder = createProjectBuilder({ worker: WORKER, execArgv });
    const pending = builder.build(input());
    await builder.close();
    await expect(pending).rejects.toThrow(/closed/);
  });
});

describe("composeBuild", () => {
  const many = (): SourceFile[] =>
    Array.from({ length: 150 }, (_, i) => ({
      path: `m/f${i}.py`,
      source: `def f${i}():\n    return ${i}\n`,
    }));

  it("builds in the thread of the request without a worker, and a small project at once", async () => {
    const parts = await composeBuild(undefined)(input(), languagePlugins);
    expect(answers(parts)).toEqual(
      answers(await buildInThread(input(), languagePlugins)),
    );
    // A worker that cannot start is never asked for a small project.
    const small = await composeBuild("/nao/existe.mjs")(
      input(),
      languagePlugins,
    );
    expect(small.counts.files).toBe(3);
  });

  it("falls back to the thread of the request when the worker fails, with the same answer and nothing left pending", async () => {
    const dir = mkdtempSync(join(tmpdir(), "8n8-builder-"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const crash = join(dir, "crash.mjs");
      writeFileSync(crash, "process.exit(3);\n");
      const build = composeBuild(crash);
      const files = many();
      const parts = await build(input(files), languagePlugins);
      expect(answers(parts)).toEqual(
        answers(await buildInThread(input(files), languagePlugins)),
      );
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not build again in its own thread when the worker ran and answered with an error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "8n8-builder-"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failing = join(dir, "failing.mjs");
      writeFileSync(
        failing,
        "import { parentPort } from 'node:worker_threads';\nparentPort.on('message', (m) => parentPort.postMessage({ id: m.id, error: 'plugin broke a rule' }));\n",
      );
      const build = composeBuild(failing);
      await expect(build(input(many()), languagePlugins)).rejects.toThrow(
        "plugin broke a rule",
      );
      // No fallback: building again would only repeat the error, after blocking this thread.
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds a project of 150 files in the worker", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const build = composeBuild(WORKER, execArgv);
    const files = many();
    const parts = await build(input(files), languagePlugins);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
    expect(parts.counts.files).toBe(150);
    expect(answers(parts)).toEqual(
      answers(await buildInThread(input(files), languagePlugins)),
    );
  });

  it("keeps the files of a project of 150 files in the analysis cache, and gives the same answers when it builds again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "8n8-compose-cache-"));
    try {
      const cacheFile = join(dir, "analysis", "cache.db");
      const build = composeBuild(WORKER, execArgv, cacheFile);
      const files = many();
      const reference = answers(
        await buildInThread(input(files), languagePlugins),
      );
      expect(answers(await build(input(files), languagePlugins))).toEqual(
        reference,
      );
      const kept = () => {
        const cache = openAnalysisCache(cacheFile);
        const found = (cache?.contributions(
          files.map((f) => `python|2|${f.path}|${sha1(f.source)}`),
        ) ?? []) as (string | undefined)[];
        cache?.close();
        return found.filter((text) => text !== undefined).length;
      };
      // The thread writes after it answers.
      for (let i = 0; i < 100 && kept() < files.length; i++) {
        await new Promise((go) => setTimeout(go, 100));
      }
      expect(kept()).toBe(files.length);
      expect(answers(await build(input(files), languagePlugins))).toEqual(
        reference,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
