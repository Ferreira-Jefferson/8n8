import type { LanguagePlugin } from "@code2n8n/model";
import { baseName } from "./layout";

/** A best score under this is a guess: the screen warns "linguagem incerta". */
export const MIN_CONFIDENT_SCORE = 0.5;
/** A best score less than this above the second one is a tie. */
export const MIN_SCORE_MARGIN = 0.15;

/** `.py` for `a/B.PY`: the last extension, in lower case; `""` when there is none. */
export function extensionOf(path: string): string {
  const base = baseName(path);
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot).toLowerCase();
}

/** The first plugin that serves the extension of `path`, or undefined. */
export function pluginForPath(
  path: string,
  plugins: LanguagePlugin[],
): LanguagePlugin | undefined {
  const ext = extensionOf(path);
  return plugins.find((p) => p.extensions.includes(ext));
}

/**
 * Picks the language of a pasted snippet (D5, AD-001): the plugin with the best
 * `detect` score; a tie goes to the first registered. `uncertain` when the best
 * score is under MIN_CONFIDENT_SCORE or the second best is within MIN_SCORE_MARGIN.
 * A single plugin is never a tie.
 */
export function detectLanguage(
  source: string,
  plugins: LanguagePlugin[],
): { plugin: LanguagePlugin; uncertain: boolean } {
  if (plugins.length === 0) throw new Error("no language plugin registered");
  const scored = plugins
    .map((plugin, index) => ({ plugin, index, score: plugin.detect(source) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const best = scored[0] as (typeof scored)[number];
  const second = scored[1];
  const uncertain =
    best.score < MIN_CONFIDENT_SCORE ||
    (second !== undefined && best.score - second.score < MIN_SCORE_MARGIN);
  return { plugin: best.plugin, uncertain };
}
