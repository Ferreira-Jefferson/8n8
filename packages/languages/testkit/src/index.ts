import type { LanguagePlugin, SourceFile } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { analysisProblems, graphProblems } from "./check";

// A Node global; this package does not load the Node types.
declare function structuredClone<T>(value: T): T;

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
          // A worker thread sends the contributions through a structured clone.
          const contributions = structuredClone(
            slices.map((slice) => slice.contribute()),
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
