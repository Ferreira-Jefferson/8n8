import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analysisWorkerEntry,
  bundleCore,
  bundleExtension,
  copyGrammars,
} from "../build";

const out = mkdtempSync(join(tmpdir(), "8n8-vscode-"));
afterAll(() => {
  try {
    rmSync(out, { recursive: true, force: true });
  } catch {
    // Windows may hold the wasm files for a moment.
  }
});

beforeAll(async () => {
  await bundleCore(join(out, "core.mjs"));
  await bundleCore(join(out, "analysis-worker.mjs"), analysisWorkerEntry);
  await bundleExtension(join(out, "extension.cjs"));
  copyGrammars(out);
}, 120_000);

describe("the extension build (VSC-07)", () => {
  it("leaves vscode out of the extension and the core out of it too", () => {
    const ext = readFileSync(join(out, "extension.cjs"), "utf8");
    expect(ext).toContain('require("vscode")');
    expect(ext).not.toContain("function createCore");
    // The core is loaded at run time, never required: it awaits at the top level.
    expect(ext).toMatch(/import\(.*"core\.mjs"/);
  });

  it("ships the grammars and tree-sitter's runtime next to the bundles", () => {
    expect(readdirSync(join(out, "grammars")).sort()).toEqual([
      "tree-sitter-python.wasm",
      "tree-sitter-tsx.wasm",
      "tree-sitter-typescript.wasm",
    ]);
    expect(existsSync(join(out, "web-tree-sitter.wasm"))).toBe(true);
  });

  it("maps Python and TypeScript from the core bundle, outside the repository", async () => {
    const { createCore } = (await import(
      pathToFileURL(join(out, "core.mjs")).href
    )) as typeof import("@8n8/server");
    const token = "vscode-build-token-not-a-secret-00000";
    const app = createCore({
      env: {},
      ptsRules: "regras",
      steRules: "regras",
      cacheDir: join(out, "cache"),
      historyFile: undefined,
      port: 8148,
      token,
      settings: { read: async () => ({}), write: async () => {} },
    });
    const graph = async (source: string) => {
      const res = await app.fetch(
        new Request("http://127.0.0.1:8148/api/graph", {
          method: "POST",
          headers: {
            host: "127.0.0.1:8148",
            "x-8n8-token": token,
            "content-type": "application/json",
          },
          body: JSON.stringify({ source }),
        }),
      );
      return (await res.json()) as { language: { id: string } };
    };
    expect((await graph("def f():\n    return 1\n")).language.id).toBe(
      "python",
    );
    expect(
      (await graph("export function f(): number {\n  return 1;\n}\n")).language
        .id,
    ).toBe("typescript");
  });

  it("maps a large folder through the worker threads of the bundle", async () => {
    const { createCore } = (await import(
      pathToFileURL(join(out, "core.mjs")).href
    )) as typeof import("@8n8/server");
    // More files than the threshold below which the core stays in one thread.
    const folder = join(out, "grande");
    mkdirSync(folder, { recursive: true });
    for (let i = 0; i < 200; i++) {
      const next = (i + 1) % 200;
      writeFileSync(
        join(folder, `m${i}.py`),
        `from m${next} import f${next}\n\n\ndef f${i}():\n    return f${next}()\n`,
      );
    }
    const token = "vscode-build-token-not-a-secret-00000";
    const app = createCore({
      env: {},
      ptsRules: "regras",
      steRules: "regras",
      cacheDir: join(out, "cache"),
      analysisWorker: join(out, "analysis-worker.mjs"),
      historyFile: undefined,
      port: 8148,
      token,
      settings: { read: async () => ({}), write: async () => {} },
    });
    const res = await app.fetch(
      new Request("http://127.0.0.1:8148/api/project", {
        method: "POST",
        headers: {
          host: "127.0.0.1:8148",
          "x-8n8-token": token,
          "content-type": "application/json",
        },
        body: JSON.stringify({ path: folder }),
      }),
    );
    const { graph } = (await res.json()) as {
      graph: { nodes: { kind: string }[]; edges: { kind: string }[] };
    };
    expect(graph.nodes.filter((n) => n.kind === "file")).toHaveLength(200);
    expect(graph.edges.filter((e) => e.kind === "imports")).toHaveLength(200);
  }, 60_000);
});
