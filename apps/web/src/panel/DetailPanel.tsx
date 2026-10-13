import type { Explanation, FlowNode, NodeId } from "@code2n8n/model";
import { useEffect, useState } from "react";
import { type ExplainResult, fetchExplanation } from "../api";
import { CodeView } from "./CodeView";

export interface DetailPanelProps {
  source: string;
  node: FlowNode;
  onExplained: (id: NodeId, explanation: Explanation) => void;
}

type Loaded = ExplainResult | { status: "loading" };

function nodeCode(source: string, node: FlowNode): string {
  return source
    .split(/\r?\n/)
    .slice(node.range.start - 1, node.range.end)
    .join("\n");
}

/** Lines and code of the selected node; summary for function and class (CORE-14, 16, 19, 20, 24). */
export function DetailPanel({ source, node, onExplained }: DetailPanelProps) {
  const explains = node.kind === "function" || node.kind === "class";
  const [result, setResult] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [highlighted, setHighlighted] = useState<number | undefined>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: onExplained is a callback, not an input; attempt triggers the retry
  useEffect(() => {
    setHighlighted(undefined);
    if (!explains) {
      setResult(null);
      return;
    }
    let live = true;
    setResult({ status: "loading" });
    fetchExplanation(source, node.id).then((r) => {
      if (!live) return;
      setResult(r);
      if (r.status === "ok") onExplained(node.id, r.explanation);
    });
    return () => {
      live = false;
    };
  }, [source, node.id, explains, attempt]);

  return (
    <aside className="detail-panel" aria-label="Detalhe do nó">
      <h2>{node.label}</h2>
      <p>{`Linhas ${node.range.start}–${node.range.end}`}</p>
      <CodeView
        code={nodeCode(source, node)}
        start={node.range.start}
        highlightedLine={highlighted}
      />
      {result && (
        <ExplanationView
          result={result}
          onRetry={() => setAttempt((a) => a + 1)}
          onSuggestion={setHighlighted}
        />
      )}
    </aside>
  );
}

function ExplanationView({
  result,
  onRetry,
  onSuggestion,
}: {
  result: Loaded;
  onRetry: () => void;
  onSuggestion: (line: number) => void;
}) {
  switch (result.status) {
    case "loading":
      return <p>Gerando resumo…</p>;
    case "no-key":
      return <p>Configure OPENROUTER_API_KEY para ver resumos</p>;
    case "stale":
      return <p>O trecho mudou. Clique em "Gerar mapa" de novo.</p>;
    case "error":
      return (
        <div>
          <p>Resumo indisponível</p>
          <button type="button" onClick={onRetry}>
            Tentar de novo
          </button>
        </div>
      );
    case "ok": {
      const { summary, inputs, outputs, suggestions } = result.explanation;
      return (
        <section className="explanation">
          <p>{summary}</p>
          <h3>Entradas</h3>
          <ul>
            {inputs.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <h3>Saídas</h3>
          <ul>
            {outputs.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <h3>Sugestões</h3>
          <ul>
            {suggestions.map((s) => (
              <li key={`${s.line}:${s.command}`}>
                <button type="button" onClick={() => onSuggestion(s.line)}>
                  {`${s.command} (linha ${s.line}, ${s.severity})`}
                </button>
                <span>{s.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      );
    }
  }
}
