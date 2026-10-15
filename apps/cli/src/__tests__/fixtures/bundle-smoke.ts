// Bundled by build.test.ts with the real grammar plugins: proves they parse from a bundle.
import { languagePlugins } from "@8n8/server";

/** The node ids each plugin extracts from one small snippet. */
export function extractBoth(): Record<string, string[]> {
  const snippets: Record<string, string> = {
    python: "def f(x):\n    if x:\n        return g(x)\n",
    typescript: "export function f(x: number) { if (x) { return g(x); } }",
  };
  return Object.fromEntries(
    languagePlugins.map((p) => [
      p.id,
      p.extract(snippets[p.id] ?? "").nodes.map((n) => n.id),
    ]),
  );
}
