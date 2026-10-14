export interface CodeViewProps {
  /** The node's exact source lines. */
  code: string;
  /** Absolute number of the first line. */
  start: number;
  highlightedLines?: ReadonlySet<number> | undefined;
}

/** Numbered source of a node with optional marked lines (CORE-14, CORE-24, FID-13). */
export function CodeView({ code, start, highlightedLines }: CodeViewProps) {
  return (
    <pre className="code code-view">
      {code.split("\n").map((text, i) => {
        const line = start + i;
        const current = highlightedLines?.has(line) ?? false;
        return (
          <div
            key={line}
            data-line={line}
            aria-current={current ? "true" : undefined}
            className={current ? "code-line current" : "code-line"}
          >
            <span className="line-no">{line}</span>
            <code>{text}</code>
          </div>
        );
      })}
    </pre>
  );
}
