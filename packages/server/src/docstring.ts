import { docstringOmitted } from "@8n8/explain";
import {
  DEFAULT_LOCALE,
  type ExplainRequest,
  type LineRange,
  type Locale,
} from "@8n8/model";

/**
 * The code of a node with its docstring masked: same lines, docstring lines blank,
 * the first one reading `<commentPrefix> docstring omitida` (`docstring omitted` in English). The text goes apart, with its line inside the code.
 */
export function maskDocstring(
  range: LineRange,
  docstring: LineRange | undefined,
  sourceLines: string[],
  commentPrefix: string,
  locale: Locale = DEFAULT_LOCALE,
): Pick<ExplainRequest, "code" | "docstring"> {
  const lines = sourceLines.slice(range.start - 1, range.end);
  if (!docstring) return { code: lines.join("\n") };
  const from = Math.max(docstring.start, range.start);
  const to = Math.min(docstring.end, range.end);
  if (from > to) return { code: lines.join("\n") };
  const text = lines.slice(from - range.start, to - range.start + 1);
  const omitted = docstringOmitted(commentPrefix, locale);
  const masked = lines.map((line, i) => {
    const abs = range.start + i;
    if (abs < from || abs > to) return line;
    return abs === from ? omitted : "";
  });
  return {
    code: masked.join("\n"),
    docstring: { text: text.join("\n"), line: from - range.start + 1 },
  };
}
