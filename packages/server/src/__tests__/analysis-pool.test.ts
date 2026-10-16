import { fileURLToPath } from "node:url";
import { readSourceFolder } from "@8n8/input";
import type { AnalysisRunner } from "@8n8/project";
import { analyzeProject, analyzeProjectParallel } from "@8n8/project";
import { afterEach, describe, expect, it } from "vitest";
import { type AnalysisPool, createAnalysisPool } from "../analysis-pool";
import { languagePlugins } from "../plugins";

const fixture = (name: string) =>
  fileURLToPath(
    new URL(
      `../../../languages/${name}/src/__tests__/fixtures/projeto-loja`,
      import.meta.url,
    ),
  );
const WORKER = fileURLToPath(new URL("../analysis-worker.ts", import.meta.url));

/** The Python and the TypeScript fixture in one project: both plugins, both in slices. */
async function lojaFiles() {
  const filter = {
    extensions: languagePlugins.flatMap((p) => p.extensions),
    ignoredDirs: [],
    ignoreDependencies: false,
  };
  const folders = await Promise.all(
    ["python", "typescript"].map((name) =>
      readSourceFolder(fixture(name), filter),
    ),
  );
  return folders.flatMap((f) => (f.kind === "ok" ? f.files : []));
}

let pool: AnalysisPool | undefined;
afterEach(async () => {
  await pool?.close();
  pool = undefined;
});

describe("analyzeProjectParallel", () => {
  it.each([1, 2, 5])(
    "gives the same project as analyzeProject with %i workers",
    async (size) => {
      const files = await lojaFiles();
      expect(files.some((f) => f.path.endsWith(".py"))).toBe(true);
      expect(files.some((f) => f.path.endsWith(".ts"))).toBe(true);
      pool = createAnalysisPool({
        worker: WORKER,
        // The worker runs from source here: tsx reads the TypeScript and the workspace packages.
        execArgv: ["--import", "tsx"],
        size,
      });
      const sequential = analyzeProject(files, languagePlugins);
      // Counts the slices, so a silent fall back to the sequential path would fail here.
      let slices = 0;
      const counting: AnalysisRunner = {
        size,
        analyze: (plugin, group) => pool?.analyze(plugin, group) as never,
        openSlice: (plugin, group) => {
          slices++;
          return (pool as AnalysisPool).openSlice(plugin, group);
        },
      };
      const parallel = await analyzeProjectParallel(files, languagePlugins, {
        runner: counting,
        minFiles: 0,
      });
      expect(slices).toBeGreaterThanOrEqual(2);
      expect(parallel.graph.nodes.length).toBeGreaterThan(50);
      expect(parallel).toEqual(sequential);
      // The same pool serves a second call.
      expect(
        await analyzeProjectParallel(files, languagePlugins, {
          runner: pool,
          minFiles: 0,
        }),
      ).toEqual(sequential);
    },
    60_000,
  );

  it("falls back to the sequential result when a worker fails", async () => {
    const files = await lojaFiles();
    pool = createAnalysisPool({
      worker: fileURLToPath(new URL("../no-such-worker.mjs", import.meta.url)),
      size: 2,
    });
    expect(
      await analyzeProjectParallel(files, languagePlugins, {
        runner: pool,
        minFiles: 0,
      }),
    ).toEqual(analyzeProject(files, languagePlugins));
  }, 60_000);

  it("does not wake the workers for a small project", async () => {
    const files = await lojaFiles();
    const never: AnalysisRunner = {
      size: 4,
      analyze: () => Promise.reject(new Error("workers were used")),
      openSlice: () => {
        throw new Error("workers were used");
      },
    };
    expect(
      await analyzeProjectParallel(files, languagePlugins, {
        runner: never,
        minFiles: files.length + 1,
      }),
    ).toEqual(analyzeProject(files, languagePlugins));
  });
});
