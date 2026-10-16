import {
  type Claim,
  type ExplainKind,
  type ExplainPart,
  type ExternalEffect,
  explainStyle,
  type FlowNode,
  type NodeId,
  type Suggestion,
  type Summary,
  type UpdateReason,
} from "@8n8/model";
import { Fragment, useEffect, useState } from "react";
import {
  type ExplainOrigin,
  type ExplainResult,
  fetchSuggestions,
  fetchSummary,
  type SuggestionsResult,
  type SummaryResult,
} from "../api";
import { categoryTag, provisionalLabel, tagLabel } from "../flow/card";
import { type MessageKey, type Translate, useT } from "../i18n";
import { CodeView } from "./CodeView";
import { formatLines } from "./format-lines";

export interface DetailPanelProps {
  /** Text the node's lines come from: the snippet, or the node's whole file in a project. */
  source: string;
  /** Where the server reads the code to explain (AD-015). */
  origin: ExplainOrigin;
  /** The node's file in a project. */
  filePath?: string | undefined;
  /** The name a snippet shows in the heading ("trecho.py"); "trecho" without a known language. */
  snippetFile?: string | undefined;
  node: FlowNode;
  /** The reviewed title; without it the panel shows the provisional name (VID-14, 15). */
  title?: string | undefined;
  /** External effects of the node, taken from the graph (FID-14). */
  effects: ExternalEffect[];
  /** A suggestion card asks to mark this line; a new nonce marks it again (VID-33). */
  mark?: { line: number; nonce: number } | undefined;
  /** Which parts the panel asks for as soon as the node is selected; the others wait for a click (CFG-06, CFG-08). */
  auto?: Auto | undefined;
  /** The suggestions of a node, for the cards on the map (CFG-10). */
  onSuggestions: (id: NodeId, suggestions: Suggestion[]) => void;
  /** Opens the settings dialog from the no-provider notice (CFG-09). */
  onOpenSettings?: (() => void) | undefined;
  /** The provider is claude-code and Claude Code is not on this machine: the notice says so (CC-17). */
  claudeMissing?: boolean | undefined;
  /** What this map already got, by node; the panel reads it and adds to it. */
  cache?: PanelCache | undefined;
}

export interface Auto {
  summary: boolean;
  suggestions: boolean;
}

/** The answers this map already got, one map per part. */
export interface PanelCache {
  summary: Map<NodeId, SummaryResult>;
  suggestions: Map<NodeId, SuggestionsResult>;
}

/** `idle` shows the button at once, while the cache is asked behind it. */
type Loaded<T> = ExplainResult<T> | { status: "idle" } | { status: "loading" };
type Mark = (lines: ReadonlySet<number>) => void;

const MANUAL: Auto = { summary: false, suggestions: false };

const UPDATE_LABELS: Record<UpdateReason, MessageKey> = {
  code: "update.code",
  neighbours: "update.neighbours",
  "model-or-prompt": "update.modelOrPrompt",
};

function nodeCode(source: string, node: FlowNode): string {
  return source
    .split(/\r?\n/)
    .slice(node.range.start - 1, node.range.end)
    .join("\n");
}

function explainKind(node: FlowNode): ExplainKind | null {
  return node.kind === "folder" ? null : node.kind;
}

/** "CÓDIGO · trecho.py, linha 18" or "CÓDIGO · trecho.py, linhas 6 a 14" (VID-29). */
function codeHeading(file: string, node: FlowNode, t: Translate): string {
  const { start, end } = node.range;
  return start === end
    ? t("panel.codeLine", { file, n: start })
    : t("panel.codeLines", { file, a: start, b: end });
}

/** The node's title, summary, code, input and output, effects and suggestions, in the video's order (VID-28, 29, 30, 33; CORE-14, 16, 19, 20, 24; FID-09..14; CACHE-04; CFG-06..11). */
export function DetailPanel({
  source,
  origin,
  filePath,
  snippetFile,
  node,
  title,
  effects,
  mark,
  auto = MANUAL,
  onSuggestions,
  onOpenSettings,
  claudeMissing,
  cache,
}: DetailPanelProps) {
  const t = useT();
  const kind = explainKind(node);
  const [highlighted, setHighlighted] = useState<ReadonlySet<number>>();
  const target = { source, origin, node, explains: kind !== null };
  const summary = usePart<Summary>(
    "summary",
    target,
    auto.summary,
    cache?.summary,
  );
  const suggestions = usePart<Suggestion[]>(
    "suggestions",
    target,
    auto.suggestions,
    cache?.suggestions,
    onSuggestions,
  );

  // A new node starts with no marked lines.
  // biome-ignore lint/correctness/useExhaustiveDependencies: node.id is the trigger, not a value read here
  useEffect(() => {
    setHighlighted(undefined);
  }, [node.id]);

  // Declared after the clearing effect, so a card that also changes the node keeps its mark.
  useEffect(() => {
    if (mark) setHighlighted(new Set([mark.line]));
  }, [mark]);

  const name = title ?? provisionalLabel(node, t);

  const io = summary.result.status === "ok" ? summary.result.result : null;
  return (
    <aside className="panel detail-panel" aria-label={t("panel.aria")}>
      <h2>{name}</h2>
      {kind !== null && <p className="eyebrow">{t("panel.eyebrow")}</p>}
      {kind !== null && (
        <SummaryView
          result={summary.result}
          onAsk={summary.ask}
          onOpenSettings={onOpenSettings}
          claudeMissing={claudeMissing}
          onMark={setHighlighted}
        />
      )}
      {kind !== null && explainStyle(kind) === "step" && (
        <p className="rules">{t("panel.rules")}</p>
      )}
      <h3 className="eyebrow">
        {codeHeading(filePath ?? snippetFile ?? t("snippet.file"), node, t)}
      </h3>
      <CodeView
        code={nodeCode(source, node)}
        start={node.range.start}
        highlightedLines={highlighted}
      />
      {io && (io.inputs.length > 0 || io.outputs.length > 0) && (
        <>
          <h3 className="eyebrow">{t("panel.io")}</h3>
          {/* SPEC_DEVIATION: a section, not a p (C13). Reason: Biome refuses aria-label on a p. */}
          <section className="io" aria-label={t("panel.ioAria")}>
            <IoClaims claims={io.inputs} onMark={setHighlighted} />{" "}
            <span className="arrow">→</span>{" "}
            <IoClaims claims={io.outputs} onMark={setHighlighted} />
          </section>
        </>
      )}
      {(node.kind === "file" ||
        node.kind === "function" ||
        node.kind === "class" ||
        node.kind === "module") && <EffectsView effects={effects} />}
      {kind !== null && (
        <SuggestionsView
          result={suggestions.result}
          onAsk={suggestions.ask}
          onOpenSettings={onOpenSettings}
          claudeMissing={claudeMissing}
          onMark={setHighlighted}
        />
      )}
    </aside>
  );
}

interface PartTarget {
  source: string;
  origin: ExplainOrigin;
  node: FlowNode;
  /** False for folders and files: nothing to ask. */
  explains: boolean;
}

/** One fetch per part, both with the same shape. */
const FETCH: Record<
  ExplainPart,
  (
    origin: ExplainOrigin,
    nodeId: string,
    cachedOnly: boolean,
  ) => Promise<ExplainResult<unknown>>
> = {
  summary: (origin, nodeId, cachedOnly) =>
    fetchSummary(origin, nodeId, cachedOnly),
  suggestions: (origin, nodeId, cachedOnly) =>
    fetchSuggestions(origin, nodeId, cachedOnly),
};

/**
 * One part of the node's explanation. On a new node: a hit of this map shows at
 * once; the automatic mode asks for real; otherwise the button shows at once
 * while the cache is asked, a hit replaces it, and a click asks for real
 * (CFG-05, CFG-06, CFG-07, CFG-08).
 */
function usePart<T>(
  part: ExplainPart,
  { source, origin, node, explains }: PartTarget,
  auto: boolean,
  cache: Map<NodeId, ExplainResult<T>> | undefined,
  onOk?: (id: NodeId, result: T) => void,
): { result: Loaded<T>; ask: () => void } {
  const [result, setResult] = useState<Loaded<T>>({
    status: auto ? "loading" : "idle",
  });
  // A new origin object on each render must not refetch; its content decides.
  const originKey = JSON.stringify(origin);
  const target = `${originKey}|${node.id}`;
  // The click of the current node; a click on another node does not count here.
  const [click, setClick] = useState({ target: "", count: 0 });
  const clicked = click.target === target ? click.count : 0;
  const real = auto || clicked > 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: onOk is a callback, not an input; target stands for origin and node; clicked triggers a new real request
  useEffect(() => {
    if (!explains) return;
    const hit = cache?.get(node.id);
    if (hit?.status === "ok") {
      setResult(hit);
      onOk?.(node.id, hit.result);
      return;
    }
    let live = true;
    setResult({ status: real ? "loading" : "idle" });
    const ask = FETCH[part] as (
      origin: ExplainOrigin,
      nodeId: string,
      cachedOnly: boolean,
    ) => Promise<ExplainResult<T>>;
    ask(origin, node.id, !real).then((r) => {
      if (r.status === "ok") cache?.set(node.id, r);
      if (!live) return;
      setResult(r.status === "not-cached" ? { status: "idle" } : r);
      if (r.status === "ok") onOk?.(node.id, r.result);
    });
    return () => {
      live = false;
    };
  }, [source, target, explains, real, clicked, cache, part]);

  return {
    result,
    ask: () => setClick((c) => ({ target, count: c.count + 1 })),
  };
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

/** What every part shows the same way: the button, loading, no provider and a stale node. */
function PartState({
  result,
  ask,
  loading,
  onAsk,
  onOpenSettings,
  claudeMissing,
}: {
  result: Loaded<unknown>;
  ask: string;
  loading: string;
  onAsk: () => void;
  onOpenSettings: (() => void) | undefined;
  claudeMissing?: boolean | undefined;
}) {
  const t = useT();
  switch (result.status) {
    case "idle":
    case "not-cached":
      return (
        <button type="button" className="ask" onClick={onAsk}>
          {ask}
        </button>
      );
    case "loading":
      return <p>{loading}</p>;
    case "no-key":
      return (
        <div className="explanation-state">
          <p>{t(claudeMissing ? "panel.claudeMissing" : "panel.noKey")}</p>
          {onOpenSettings && (
            <button type="button" onClick={onOpenSettings}>
              {t("panel.openSettings")}
            </button>
          )}
        </div>
      );
    case "stale":
      return <p>{t("panel.stale")}</p>;
    default:
      return null;
  }
}

/** A failed or unfaithful answer, with a retry. */
function Failed({ text, onAsk }: { text: string; onAsk: () => void }) {
  const t = useT();
  return (
    <div className="explanation-state">
      <p>{text}</p>
      <button type="button" onClick={onAsk}>
        {t("panel.retry")}
      </button>
    </div>
  );
}

function SummaryView({
  result,
  onAsk,
  onOpenSettings,
  claudeMissing,
  onMark,
}: {
  result: Loaded<Summary>;
  onAsk: () => void;
  onOpenSettings: (() => void) | undefined;
  claudeMissing?: boolean | undefined;
  onMark: Mark;
}) {
  const t = useT();
  switch (result.status) {
    case "error":
      return <Failed text={t("panel.summaryFail")} onAsk={onAsk} />;
    case "unfaithful":
      return <Failed text={t("panel.unfaithful")} onAsk={onAsk} />;
    case "ok":
      return (
        <>
          <span className="review-badge">
            {result.review === "cut"
              ? t("panel.reviewedCut")
              : t("panel.reviewed")}
          </span>
          {result.update && result.update.length > 0 && (
            <p role="status">
              {t("panel.updated", {
                reasons: result.update
                  .map((u) => t(UPDATE_LABELS[u]))
                  .join(", "),
              })}
            </p>
          )}
          <ol className="summary-list" aria-label={t("panel.summaryAria")}>
            {result.result.sentences.map((c) => (
              <ClaimItem key={c.id} claim={c} onMark={onMark} />
            ))}
          </ol>
        </>
      );
    default:
      return (
        <PartState
          result={result}
          ask={t("panel.askSummary")}
          loading={t("panel.loadingSummary")}
          onAsk={onAsk}
          onOpenSettings={onOpenSettings}
          claudeMissing={claudeMissing}
        />
      );
  }
}

function SuggestionsView({
  result,
  onAsk,
  onOpenSettings,
  claudeMissing,
  onMark,
}: {
  result: Loaded<Suggestion[]>;
  onAsk: () => void;
  onOpenSettings: (() => void) | undefined;
  claudeMissing?: boolean | undefined;
  onMark: Mark;
}) {
  const t = useT();
  return (
    <section className="suggestions">
      <h3>{t("panel.suggestions")}</h3>
      {result.status === "ok" ? (
        <SuggestionList suggestions={result.result} onMark={onMark} />
      ) : result.status === "error" || result.status === "unfaithful" ? (
        <Failed text={t("panel.suggestionsFail")} onAsk={onAsk} />
      ) : (
        <PartState
          result={result}
          ask={t("panel.askSuggestions")}
          loading={t("panel.loadingSuggestions")}
          onAsk={onAsk}
          onOpenSettings={onOpenSettings}
          claudeMissing={claudeMissing}
        />
      )}
    </section>
  );
}

function SuggestionList({
  suggestions,
  onMark,
}: {
  suggestions: Suggestion[];
  onMark: Mark;
}) {
  const t = useT();
  if (suggestions.length === 0) {
    return <p>{t("panel.noSuggestions")}</p>;
  }
  return (
    <ul>
      {suggestions.map((s) => (
        <li key={s.id} data-claim-id={s.id}>
          <button type="button" onClick={() => onMark(new Set([s.line]))}>
            {t("panel.suggestionItem", {
              command: s.command,
              line: s.line,
              severity: t(`severity.${s.severity}` as MessageKey),
            })}
          </button>
          <span>{s.reason}</span>
          <Evidence lines={s.lines} onMark={onMark} />
        </li>
      ))}
    </ul>
  );
}

function EffectsView({ effects }: { effects: ExternalEffect[] }) {
  const t = useT();
  return (
    <section className="effects">
      <h3 id="efeitos">{t("panel.effects")}</h3>
      {effects.length === 0 ? (
        <p>{t("panel.noEffects")}</p>
      ) : (
        <ul aria-labelledby="efeitos">
          {effects.map((e) => (
            <li key={`${e.line}:${e.callee}`}>
              {t("panel.effectItem", {
                callee: e.callee,
                tag: tagLabel(categoryTag(e.category), t),
                line: e.line,
              })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
