import { fileURLToPath } from "node:url";
import { readSourceFolder } from "@8n8/input";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AnalysisPool, createAnalysisPool } from "../analysis-pool";
import { languagePlugins } from "../plugins";
import {
  type BuildInput,
  buildInThread,
  buildStreamed,
  type PackingRunner,
} from "../project-build";
import { answers } from "./answers";

const fixture = (name: string) =>
  fileURLToPath(
    new URL(
      `../../../languages/${name}/src/__tests__/fixtures/projeto-loja`,
      import.meta.url,
    ),
  );
const WORKER = fileURLToPath(new URL("../analysis-worker.ts", import.meta.url));

/** The Python and the TypeScript fixture in one project: both plugins, both in slices. */
async function lojaInput(): Promise<BuildInput> {
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
  return {
    name: "loja",
    files: folders.flatMap((f) => (f.kind === "ok" ? f.files : [])),
    ignored: [],
    version: "v-pool",
  };
}

let pool: AnalysisPool | undefined;
afterEach(async () => {
  await pool?.close();
  pool = undefined;
});

describe("the analysis pool, through buildStreamed", () => {
  it.each([1, 2, 5])(
    "gives the same project as the plain packing in this thread, with %i workers",
    async (size) => {
      const input = await lojaInput();
      expect(input.files.some((f) => f.path.endsWith(".py"))).toBe(true);
      expect(input.files.some((f) => f.path.endsWith(".ts"))).toBe(true);
      pool = createAnalysisPool({
        worker: WORKER,
        // The worker runs from source here: tsx reads the TypeScript and the workspace packages.
        execArgv: ["--import", "tsx"],
        size,
      });
      // Counts the slices, so a silent fall back to this thread would fail here.
      let slices = 0;
      const counting: PackingRunner = {
        size,
        runPacked: (plugin, files, pack) =>
          (pool as AnalysisPool).runPacked(plugin, files, pack),
        openPackedSlice: (plugin, files) => {
          slices++;
          return (pool as AnalysisPool).openPackedSlice(plugin, files);
        },
      };
      const plain = answers(await buildInThread(input, languagePlugins));
      const onFallback = vi.fn();
      const streamed = await buildStreamed(input, languagePlugins, counting, {
        onFallback,
      });
      expect(onFallback).not.toHaveBeenCalled();
      expect(slices).toBeGreaterThanOrEqual(2);
      expect(plain.nodes.length).toBeGreaterThan(50);
      expect(answers(streamed)).toEqual(plain);
      // The same pool serves a second build.
      expect(
        answers(await buildStreamed(input, languagePlugins, pool)),
      ).toEqual(plain);
    },
    60_000,
  );

  it("packs a plugin without slices whole, in one worker", async () => {
    const input = await lojaInput();
    pool = createAnalysisPool({
      worker: WORKER,
      execArgv: ["--import", "tsx"],
      size: 2,
    });
    // The worker finds the plugin by its id: only this thread sees it without `openSlice`.
    const whole = languagePlugins.map(
      ({ openSlice: _slices, ...plugin }) => plugin,
    );
    const streamed = await buildStreamed(input, whole, pool);
    expect(answers(streamed)).toEqual(
      answers(await buildInThread(input, whole)),
    );
  }, 60_000);

  it("falls back to this thread, with the same answer and a reason, when a worker fails", async () => {
    const input = await lojaInput();
    pool = createAnalysisPool({
      worker: fileURLToPath(new URL("../no-such-worker.mjs", import.meta.url)),
      size: 2,
    });
    const onFallback = vi.fn();
    const streamed = await buildStreamed(input, languagePlugins, pool, {
      onFallback,
    });
    expect(onFallback).toHaveBeenCalled();
    expect(answers(streamed)).toEqual(
      answers(await buildInThread(input, languagePlugins)),
    );
  }, 60_000);
});
