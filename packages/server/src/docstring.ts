import type { ExplainRequest, LineRange } from "@code2n8n/model";

const OMITTED = "# docstring omitida";

/**
 * The code of a node with its docstring masked: same lines, docstring lines blank,
 * the first one reading `# docstring omitida`. The text goes apart, with its line inside the code.
 */
export function maskDocstring(
  range: LineRange,
  docstring: LineRange | undefined,
  sourceLines: string[],
): Pick<ExplainRequest, "code" | "docstring"> {
  const lines = sourceLines.slice(range.start - 1, range.end);
  if (!docstring) return { code: lines.join("\n") };
  const from = Math.max(docstring.start, range.start);
  const to = Math.min(docstring.end, range.end);
  if (from > to) return { code: lines.join("\n") };
  const text = lines.slice(from - range.start, to - range.start + 1);
  const masked = lines.map((line, i) => {
    const abs = range.start + i;
    if (abs < from || abs > to) return line;
    return abs === from ? OMITTED : "";
  });
  return {
    code: masked.join("\n"),
    docstring: { text: text.join("\n"), line: from - range.start + 1 },
  };
}
