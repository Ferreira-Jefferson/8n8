import { docstringOmitted } from "@8n8/explain";
import {
  DEFAULT_LOCALE,
  type ExplainRequest,
  type LineRange,
  type Locale,
} from "@8n8/model";

/**
 * The code of a node with its docstrings masked: same lines, docstring lines blank,
 * the first one of each reading `<commentPrefix> docstring omitida` (`docstring omitted` in English).
 * A file passes the docstrings of every node in it. The text of the first one goes apart, with its line inside the code.
 */
export function maskDocstring(
  range: LineRange,
  docstring: LineRange | readonly LineRange[] | undefined,
  sourceLines: string[],
  commentPrefix: string,
  locale: Locale = DEFAULT_LOCALE,
): Pick<ExplainRequest, "code" | "docstring"> {
  const lines = sourceLines.slice(range.start - 1, range.end);
  const spans = (
    Array.isArray(docstring) ? docstring : docstring ? [docstring] : []
  )
    .map((d: LineRange) => ({
      from: Math.max(d.start, range.start),
      to: Math.min(d.end, range.end),
    }))
    .filter((d) => d.from <= d.to)
    .sort((a, b) => a.from - b.from);
  const first = spans[0];
  if (!first) return { code: lines.join("\n") };
  const omitted = docstringOmitted(commentPrefix, locale);
  const masked = lines.map((line, i) => {
    const abs = range.start + i;
    const span = spans.find((d) => abs >= d.from && abs <= d.to);
    if (!span) return line;
    return abs === span.from ? omitted : "";
  });
  const text = lines.slice(
    first.from - range.start,
    first.to - range.start + 1,
  );
  return {
    code: masked.join("\n"),
    docstring: { text: text.join("\n"), line: first.from - range.start + 1 },
  };
}
