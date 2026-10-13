import type {
  Claim,
  Explanation,
  ExternalEffect,
  FlowNode,
  NodeId,
  UpdateReason,
} from "@code2n8n/model";
import { useEffect, useState } from "react";
import { type ExplainResult, fetchExplanation } from "../api";
import { CodeView } from "./CodeView";
import { formatLines } from "./format-lines";

export interface DetailPanelProps {
  source: string;
  node: FlowNode;
  /** External effects of the node, taken from the graph (FID-14). */
  effects: ExternalEffect[];
  onExplained: (id: NodeId, explanation: Explanation) => void;
}

type Loaded = ExplainResult | { status: "loading" };
type Mark = (lines: ReadonlySet<number>) => void;

const UPDATE_LABELS: Record<UpdateReason, string> = {
  code: "o código mudou",
  neighbours: "os vizinhos mudaram",
  "model-or-prompt": "o modelo ou o prompt mudou",
};

function nodeCode(source: string, node: FlowNode): string {
  return source
    .split(/\r?\n/)
    .slice(node.range.start - 1, node.range.end)
    .join("\n");
}

/** Lines and code of the selected node; reviewed summary and effects for function and class (CORE-14, 16, 19, 20, 24; FID-09..14; CACHE-04). */
export function DetailPanel({
  source,
  node,
  effects,
  onExplained,
}: DetailPanelProps) {
  const explains = node.kind === "function" || node.kind === "class";
  const [result, setResult] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [highlighted, setHighlighted] = useState<ReadonlySet<number>>();

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
        highlightedLines={highlighted}
      />
      {result && (
        <ExplanationView
          result={result}
          onRetry={() => setAttempt((a) => a + 1)}
          onMark={setHighlighted}
        />
      )}
      {explains && <EffectsView effects={effects} />}
    </aside>
  );
}

function ClaimItem({ claim, onMark }: { claim: Claim; onMark: Mark }) {
  return (
    <li data-claim-id={claim.id}>
      <span>{claim.text}</span>
      {claim.lines.length > 0 && (
        <button type="button" onClick={() => onMark(new Set(claim.lines))}>
          {formatLines(claim.lines)}
        </button>
      )}
    </li>
  );
}

function ExplanationView({
  result,
  onRetry,
  onMark,
}: {
  result: Loaded;
  onRetry: () => void;
  onMark: Mark;
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
    case "unfaithful":
      return (
        <div>
          <p>Não foi possível gerar um resumo fiel.</p>
          <button type="button" onClick={onRetry}>
            Tentar de novo
          </button>
        </div>
      );
    case "ok": {
      const { sentences, inputs, outputs, suggestions } = result.explanation;
      return (
        <section className="explanation">
          <span className="review-badge">
            {result.review === "cut" ? "Revisado com cortes" : "Revisado"}
          </span>
          {result.update && result.update.length > 0 && (
            <p role="status">
              {`Resumo atualizado: ${result.update.map((u) => UPDATE_LABELS[u]).join(", ")}`}
            </p>
          )}
          <ol aria-label="Resumo">
            {sentences.map((c) => (
              <ClaimItem key={c.id} claim={c} onMark={onMark} />
            ))}
          </ol>
          <h3>Entradas</h3>
          <ul>
            {inputs.map((c) => (
              <ClaimItem key={c.id} claim={c} onMark={onMark} />
            ))}
          </ul>
          <h3>Saídas</h3>
          <ul>
            {outputs.map((c) => (
              <ClaimItem key={c.id} claim={c} onMark={onMark} />
            ))}
          </ul>
          <h3>Sugestões</h3>
          <ul>
            {suggestions.map((s) => (
              <li key={s.id} data-claim-id={s.id}>
                <button type="button" onClick={() => onMark(new Set([s.line]))}>
                  {`${s.command} (linha ${s.line}, ${s.severity})`}
                </button>
                <span>{s.reason}</span>
                {s.lines.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onMark(new Set(s.lines))}
                  >
                    {formatLines(s.lines)}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      );
    }
  }
}

function EffectsView({ effects }: { effects: ExternalEffect[] }) {
  return (
    <section className="effects">
      <h3 id="efeitos">Efeitos externos</h3>
      {effects.length === 0 ? (
        <p>Nenhum efeito externo.</p>
      ) : (
        <ul aria-labelledby="efeitos">
          {effects.map((e) => (
            <li key={`${e.line}:${e.callee}`}>
              {`${e.callee} (${e.category}, linha ${e.line})`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
