import {
  type Claim,
  type ExplainKind,
  type Explanation,
  type ExternalEffect,
  explainStyle,
  type FlowNode,
  type NodeId,
  type UpdateReason,
} from "@code2n8n/model";
import { Fragment, useEffect, useState } from "react";
import {
  type ExplainOrigin,
  type ExplainResult,
  fetchExplanation,
} from "../api";
import { categoryTag, provisionalLabel } from "../flow/card";
import { CodeView } from "./CodeView";
import { formatLines } from "./format-lines";

export interface DetailPanelProps {
  /** Text the node's lines come from: the snippet, or the node's whole file in a project. */
  source: string;
  /** Where the server reads the code to explain (AD-015). */
  origin: ExplainOrigin;
  /** The node's file in a project; a snippet is "trecho.py". */
  filePath?: string | undefined;
  node: FlowNode;
  /** The reviewed title; without it the panel shows the provisional name (VID-14, 15). */
  title?: string | undefined;
  /** External effects of the node, taken from the graph (FID-14). */
  effects: ExternalEffect[];
  /** A suggestion card asks to mark this line; a new nonce marks it again (VID-33). */
  mark?: { line: number; nonce: number } | undefined;
  onExplained: (id: NodeId, explanation: Explanation) => void;
}

type Loaded = ExplainResult | { status: "loading" };
type Mark = (lines: ReadonlySet<number>) => void;

const UPDATE_LABELS: Record<UpdateReason, string> = {
  code: "o código mudou",
  neighbours: "os vizinhos mudaram",
  "model-or-prompt": "o modelo ou o prompt mudou",
};

const SNIPPET_FILE = "trecho.py";

function nodeCode(source: string, node: FlowNode): string {
  return source
    .split(/\r?\n/)
    .slice(node.range.start - 1, node.range.end)
    .join("\n");
}

function explainKind(node: FlowNode): ExplainKind | null {
  return node.kind === "folder" || node.kind === "file" ? null : node.kind;
}

/** "CÓDIGO · trecho.py, linha 18" or "CÓDIGO · trecho.py, linhas 6 a 14" (VID-29). */
function codeHeading(file: string, node: FlowNode): string {
  const { start, end } = node.range;
  const lines = start === end ? `linha ${start}` : `linhas ${start} a ${end}`;
  return `CÓDIGO · ${file}, ${lines}`;
}

/** The node's title, summary, code, input and output, effects and suggestions, in the video's order (VID-28, 29, 30, 33; CORE-14, 16, 19, 20, 24; FID-09..14; CACHE-04). */
export function DetailPanel({
  source,
  origin,
  filePath,
  node,
  title,
  effects,
  mark,
  onExplained,
}: DetailPanelProps) {
  const kind = explainKind(node);
  const [result, setResult] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [highlighted, setHighlighted] = useState<ReadonlySet<number>>();
  // A new origin object on each render must not refetch; its content decides.
  const originKey = JSON.stringify(origin);

  // biome-ignore lint/correctness/useExhaustiveDependencies: onExplained is a callback, not an input; originKey stands for origin; attempt triggers the retry
  useEffect(() => {
    setHighlighted(undefined);
    if (kind === null) {
      setResult(null);
      return;
    }
    let live = true;
    setResult({ status: "loading" });
    fetchExplanation(origin, node.id).then((r) => {
      if (!live) return;
      setResult(r);
      if (r.status === "ok") onExplained(node.id, r.explanation);
    });
    return () => {
      live = false;
    };
  }, [source, originKey, node.id, kind, attempt]);

  // Declared after the fetch effect, so a card that also changes the node keeps its mark.
  useEffect(() => {
    if (mark) setHighlighted(new Set([mark.line]));
  }, [mark]);

  const name = title ?? provisionalLabel(node);

  if (node.kind === "folder") {
    return (
      <aside className="panel detail-panel" aria-label="Detalhe do nó">
        <h2>{name}</h2>
        <p>{`Pasta: ${node.path ?? ""}`}</p>
      </aside>
    );
  }

  const ok = result?.status === "ok" ? result : null;
  const io = ok?.explanation;
  return (
    <aside className="panel detail-panel" aria-label="Detalhe do nó">
      <h2>{name}</h2>
      {kind !== null && (
        <p className="eyebrow">O QUE FAZ · PORTUGUÊS TÉCNICO SIMPLIFICADO</p>
      )}
      {result && (
        <SummaryView
          result={result}
          onRetry={() => setAttempt((a) => a + 1)}
          onMark={setHighlighted}
        />
      )}
      {kind !== null && explainStyle(kind) === "step" && (
        <p className="rules">2 frases · voz ativa · um termo por conceito</p>
      )}
      <h3 className="eyebrow">{codeHeading(filePath ?? SNIPPET_FILE, node)}</h3>
      <CodeView
        code={nodeCode(source, node)}
        start={node.range.start}
        highlightedLines={highlighted}
      />
      {io && (io.inputs.length > 0 || io.outputs.length > 0) && (
        <>
          <h3 className="eyebrow">ENTRADA E SAÍDA</h3>
          {/* SPEC_DEVIATION: a section, not a p (C13). Reason: Biome refuses aria-label on a p. */}
          <section className="io" aria-label="Entrada e saída">
            <IoClaims claims={io.inputs} onMark={setHighlighted} />{" "}
            <span className="arrow">→</span>{" "}
            <IoClaims claims={io.outputs} onMark={setHighlighted} />
          </section>
        </>
      )}
      {(node.kind === "function" ||
        node.kind === "class" ||
        node.kind === "module") && <EffectsView effects={effects} />}
      {io && (
        <SuggestionsView suggestions={io.suggestions} onMark={setHighlighted} />
      )}
    </aside>
  );
}

function Evidence({ lines, onMark }: { lines: number[]; onMark: Mark }) {
  if (lines.length === 0) return null;
  return (
    <button type="button" onClick={() => onMark(new Set(lines))}>
      {formatLines(lines)}
    </button>
  );
}

function ClaimItem({ claim, onMark }: { claim: Claim; onMark: Mark }) {
  return (
    <li data-claim-id={claim.id}>
      <span>{claim.text}</span>
      <Evidence lines={claim.lines} onMark={onMark} />
    </li>
  );
}

/** Input or output claims of the IO line, without backticks, each with its evidence (VID-30, FID-12). */
function IoClaims({ claims, onMark }: { claims: Claim[]; onMark: Mark }) {
  return claims.map((c, i) => (
    <Fragment key={c.id}>
      {i > 0 && ", "}
      <span data-claim-id={c.id}>
        {c.text.replaceAll("`", "")}
        <Evidence lines={c.lines} onMark={onMark} />
      </span>
    </Fragment>
  ));
}

function SummaryView({
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
        <div className="explanation-state">
          <p>Resumo indisponível</p>
          <button type="button" onClick={onRetry}>
            Tentar de novo
          </button>
        </div>
      );
    case "unfaithful":
      return (
        <div className="explanation-state">
          <p>Não foi possível gerar um resumo fiel.</p>
          <button type="button" onClick={onRetry}>
            Tentar de novo
          </button>
        </div>
      );
    case "ok":
      return (
        <>
          <span className="review-badge">
            {result.review === "cut" ? "Revisado com cortes" : "Revisado"}
          </span>
          {result.update && result.update.length > 0 && (
            <p role="status">
              {`Resumo atualizado: ${result.update.map((u) => UPDATE_LABELS[u]).join(", ")}`}
            </p>
          )}
          <ol aria-label="Resumo">
            {result.explanation.sentences.map((c) => (
              <ClaimItem key={c.id} claim={c} onMark={onMark} />
            ))}
          </ol>
        </>
      );
  }
}

function SuggestionsView({
  suggestions,
  onMark,
}: {
  suggestions: Explanation["suggestions"];
  onMark: Mark;
}) {
  return (
    <section className="suggestions">
      <h3>Sugestões</h3>
      <ul>
        {suggestions.map((s) => (
          <li key={s.id} data-claim-id={s.id}>
            <button type="button" onClick={() => onMark(new Set([s.line]))}>
              {`${s.command} (linha ${s.line}, ${s.severity})`}
            </button>
            <span>{s.reason}</span>
            <Evidence lines={s.lines} onMark={onMark} />
          </li>
        ))}
      </ul>
    </section>
  );
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
              {`${e.callee} (${categoryTag(e.category)}, linha ${e.line})`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
