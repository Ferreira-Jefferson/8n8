import type { FileContribution, LanguagePlugin, SourceFile } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { analysisProblems, graphProblems } from "./check";

export { analysisProblems, graphProblems, lineCount } from "./check";

export interface ConformanceFixtures {
  /** Snippets of the language, for `extract` and `detect`. */
  snippets: string[];
  /** The files of a small project, for `analyze`. Paths are POSIX. */
  files: SourceFile[];
}

/**
 * Registers the conformance suite of a language plugin: determinism, unique
 * ids, pre-order, 1-based inclusive lines, the `openable` rule (VID-24), and
 * the shape `analyze` must return. Every plugin runs the same suite.
 */
export function describeLanguagePlugin(
  plugin: LanguagePlugin,
  fixtures: ConformanceFixtures,
): void {
  describe(`language plugin ${plugin.id}: conformance`, () => {
    it("declares id, label, extensions, comment prefix and ignored folders", () => {
      expect(plugin.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(plugin.id).not.toBe("mixed");
      expect(plugin.label).not.toBe("");
      expect(plugin.extensions.length).toBeGreaterThan(0);
      for (const ext of plugin.extensions) {
        expect(ext).toMatch(/^\.[a-z0-9]+$/);
      }
      expect(plugin.commentPrefix).not.toBe("");
      for (const dir of plugin.ignoredDirs) {
        expect(dir).not.toBe("");
        expect(dir).not.toContain("/");
      }
    });

    it.each(fixtures.snippets.map((s, i) => [`snippet ${i + 1}`, s]))(
      "extract gives a deterministic, well-formed graph: %s",
      (_name, source) => {
        const graph = plugin.extract(source as string);

        expect(plugin.extract(source as string)).toEqual(graph);
        expect(graph.language).toBe(plugin.id);
        expect(graph.empty).toBe(graph.nodes.length === 0);
        expect(graphProblems(graph, source as string)).toEqual([]);
      },
    );

    it.each(fixtures.snippets.map((s, i) => [`snippet ${i + 1}`, s]))(
      "detect gives a deterministic score from 0 to 1: %s",
      (_name, source) => {
        const score = plugin.detect(source as string);

        expect(plugin.detect(source as string)).toBe(score);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      },
    );

    it("analyze gives the same analysis for the same files", () => {
      expect(plugin.analyze(fixtures.files)).toEqual(
        plugin.analyze(fixtures.files),
      );
    });

    it("analyze gives one graph per file, the file node first, ids under file:<path>", () => {
      const analysis = plugin.analyze(fixtures.files);

      expect(analysisProblems(fixtures.files, analysis, plugin.id)).toEqual([]);
    });

    it("analyze gives ids that are unique across all files", () => {
      const ids = plugin
        .analyze(fixtures.files)
        .files.flatMap((f) => f.graph.nodes.map((n) => n.id));

      expect(new Set(ids).size).toBe(ids.length);
    });

    it.skipIf(plugin.openSlice === undefined)(
      "slices of the files, joined in order, give the same analysis as analyze",
      () => {
        const sorted = [...fixtures.files].sort((a, b) =>
          a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
        );
        const cut = (n: number) => Math.floor((sorted.length * n) / 3);
        const slices = [0, 1, 2].map((i) =>
          (plugin.openSlice as NonNullable<typeof plugin.openSlice>)(
            sorted.slice(cut(i), cut(i + 1)),
          ),
        );
        try {
          // The core keeps the contributions as JSON text, and a worker thread sends them through a structured clone.
          const contributions = JSON.parse(
            JSON.stringify(slices.flatMap((slice) => slice.contribute())),
          ) as FileContribution[];
          expect(contributions.map((c) => c.path)).toEqual(
            sorted.map((f) => f.path),
          );
          const parts = slices.map((slice) => slice.analyze(contributions));
          expect({
            files: parts.flatMap((p) => p.files),
            imports: parts.flatMap((p) => p.imports),
            offers: parts.flatMap((p) => p.offers),
            requests: parts.flatMap((p) => p.requests),
          }).toEqual(plugin.analyze(fixtures.files));
        } finally {
          for (const slice of slices) slice.dispose();
        }
      },
    );

    it.skipIf(plugin.openSlice === undefined)(
      "the contribution of a file does not depend on the other files, and a slice of some files gives their graphs with the contributions of all",
      () => {
        const sorted = [...fixtures.files].sort((a, b) =>
          a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
        );
        const open = (files: typeof sorted) =>
          (plugin.openSlice as NonNullable<typeof plugin.openSlice>)(files);
        const whole = open(sorted);
        const alone = sorted.map((file) => open([file]));
        try {
          const all = whole.contribute();
          expect(alone.flatMap((s) => s.contribute())).toEqual(all);
          // Every other file, one slice: the same graphs as in the whole analysis.
          const odd = sorted.filter((_, i) => i % 2 === 1);
          const some = open(odd);
          try {
            const full = plugin.analyze(fixtures.files);
            expect(some.analyze(all).files).toEqual(
              full.files.filter((f) => odd.some((o) => o.path === f.path)),
            );
          } finally {
            some.dispose();
          }
        } finally {
          whole.dispose();
          for (const slice of alone) slice.dispose();
        }
      },
    );

    it("analyze of no files gives nothing", () => {
      expect(plugin.analyze([])).toEqual({
        files: [],
        imports: [],
        offers: [],
        requests: [],
      });
    });
  });
}
