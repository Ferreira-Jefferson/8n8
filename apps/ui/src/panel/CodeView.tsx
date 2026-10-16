import hljs from "highlight.js/lib/common";
import { type ReactNode, useMemo } from "react";

export interface CodeViewProps {
  /** The node's exact source lines. */
  code: string;
  /** Absolute number of the first line. */
  start: number;
  highlightedLines?: ReadonlySet<number> | undefined;
  /** File name or path. Its extension picks the language to color. */
  file?: string | undefined;
}

/** The highlight.js language for a file's extension, or undefined when unknown. */
function languageOf(file: string | undefined): string | undefined {
  const ext = file?.split(".").pop()?.toLowerCase();
  return ext && hljs.getLanguage(ext) ? ext : undefined;
}

/** Splits highlighted HTML per line, closing and reopening spans that cross a line break. */
function splitLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = "";
  for (const part of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (part === "\n") {
      lines.push(current + "</span>".repeat(open.length));
      current = open.join("");
      continue;
    }
    if (part.startsWith("<span")) open.push(part);
    else if (part === "</span>") open.pop();
    current += part;
  }
  lines.push(current + "</span>".repeat(open.length));
  return lines;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#x27": "'",
};

/** Turns one balanced line of highlight.js HTML into React nodes (no raw HTML). */
function toNodes(html: string): ReactNode[] {
  const root: ReactNode[] = [];
  const open: { className: string; children: ReactNode[] }[] = [];
  const target = () => open.at(-1)?.children ?? root;
  for (const part of html.split(/(<span[^>]*>|<\/span>)/)) {
    if (part.startsWith("<span")) {
      const className = /class="([^"]*)"/.exec(part)?.[1] ?? "";
      open.push({ className, children: [] });
    } else if (part === "</span>") {
      const done = open.pop();
      if (done) {
        const parent = target();
        parent.push(
          <span key={parent.length} className={done.className}>
            {done.children}
          </span>,
        );
      }
    } else if (part) {
      target().push(
        part.replace(
          /&(amp|lt|gt|quot|#x27);/g,
          (_, name: string) => ENTITIES[name] ?? _,
        ),
      );
    }
  }
  return root;
}

function colorLines(
  code: string,
  file: string | undefined,
): ReactNode[][] | null {
  const language = languageOf(file);
  if (!language) return null;
  const { value } = hljs.highlight(code, { language, ignoreIllegals: true });
  return splitLines(value).map(toNodes);
}

/** Numbered source of a node with optional marked lines (CORE-14, CORE-24, FID-13). */
export function CodeView({
  code,
  start,
  highlightedLines,
  file,
}: CodeViewProps) {
  const colored = useMemo(() => colorLines(code, file), [code, file]);
  return (
    <pre className="code code-view">
      {code.split("\n").map((text, i) => {
        const line = start + i;
        const current = highlightedLines?.has(line) ?? false;
        const nodes = colored?.[i];
        return (
          <div
            key={line}
            data-line={line}
            aria-current={current ? "true" : undefined}
            className={current ? "code-line current" : "code-line"}
          >
            <span className="line-no">{line}</span>
            <code>{nodes ?? text}</code>
          </div>
        );
      })}
    </pre>
  );
}
