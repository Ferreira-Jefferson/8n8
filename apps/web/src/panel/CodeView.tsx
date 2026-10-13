export interface CodeViewProps {
  /** The node's exact source lines. */
  code: string;
  /** Absolute number of the first line. */
  start: number;
  highlightedLine?: number | undefined;
}

/** Numbered source of a node with an optional marked line (CORE-14, CORE-24). */
export function CodeView({ code, start, highlightedLine }: CodeViewProps) {
  return (
    <pre className="code-view">
      {code.split("\n").map((text, i) => {
        const line = start + i;
        const current = line === highlightedLine;
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
