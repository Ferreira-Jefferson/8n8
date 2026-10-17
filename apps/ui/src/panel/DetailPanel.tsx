import {
  type Claim,
  type ExplainKind,
  type ExplainPart,
  type ExternalEffect,
  explainStyle,
  type FlowNode,
  type NodeId,
  type NodeNotes,
  type Suggestion,
  type Summary,
  suggestionKey,
  type UpdateReason,
} from "@8n8/model";
import {
  Fragment,
  type KeyboardEvent,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  type ExplainOrigin,
  type ExplainResult,
  fetchNotes,
  fetchSuggestions,
  fetchSummary,
  type NotesOp,
  type SuggestionsResult,
  type SummaryResult,
} from "../api";
import { categoryTag, provisionalLabel, tagLabel } from "../flow/card";
import { type MessageKey, type Translate, useT } from "../i18n";
import { type ChatEntry, ChatTab } from "./ChatTab";
import { CodeView } from "./CodeView";
import { formatLines } from "./format-lines";
import { RichInline } from "./Rich";

export interface DetailPanelProps {
  /** Text the node's lines come from: the snippet, or the node's whole file in a project; absent while the file is on its way. */
  source?: string | undefined;
  /** The node's file failed to load: the code area says so and offers this button, instead of loading. */
  onRetry?: (() => void) | undefined;
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
  /** What was talked about each node; absent where the panel is tested without a chat. */
  chat?: Map<NodeId, ChatEntry[]>;
  /** What the person kept from the chat and removed, by node. */
  notes?: Map<NodeId, NodeNotes>;
}

/** `idle` shows the button at once, while the cache is asked behind it. */
type Loaded<T> = ExplainResult<T> | { status: "idle" } | { status: "loading" };
type Mark = (lines: ReadonlySet<number>) => void;

const MANUAL: Auto = { summary: false, suggestions: false };
const NO_NOTES: NodeNotes = { saved: [], dismissed: [] };

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
  onRetry,
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
  const [tab, setTab] = useState<TabId>("code");
  // A "Gerar" button of an empty tab runs the shortcut in the chat; the nonce makes a second click run it again.
  const [command, setCommand] = useState<ChatCommand>();
  const runInChat = (part: ExplainPart) => {
    setTab("chat");
    setCommand({ part, nodeId: node.id, nonce: (command?.nonce ?? 0) + 1 });
  };
  // A mark always lands on the code, so the tab follows it.
  const showLines: Mark = (lines) => {
    setHighlighted(lines);
    setTab("code");
  };
  const target = { origin, node, explains: kind !== null };
  const summary = usePart<Summary>(
    "summary",
    target,
    auto.summary,
    cache?.summary,
  );
  // The suggestions of a node on the map: the generated ones that were not removed, and the ones kept from the chat.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const localNotes = useRef(new Map<NodeId, NodeNotes>());
  const notesOf = cache?.notes ?? localNotes.current;
  const generated = useRef(new Map<NodeId, Suggestion[]>());
  const emitted = useRef(new Set<NodeId>());
  const latest = useRef(onSuggestions);
  latest.current = onSuggestions;
  const emit = (id: NodeId) => {
    const gen = generated.current.get(id);
    const notes = notesOf.get(id) ?? NO_NOTES;
    if (!gen && notes.saved.length === 0 && !emitted.current.has(id)) return;
    emitted.current.add(id);
    latest.current(id, [...withoutDismissed(gen ?? [], notes), ...notes.saved]);
  };
  const suggestions = usePart<Suggestion[]>(
    "suggestions",
    target,
    auto.suggestions,
    cache?.suggestions,
    (id, list) => {
      generated.current.set(id, list);
      emit(id);
    },
  );
  const originKey = JSON.stringify(origin);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the node and the origin are the triggers; the rest is read from refs
  useEffect(() => {
    if (kind === null || notesOf.has(node.id)) return;
    const id = node.id;
    let live = true;
    fetchNotes(origin, id, { action: "get" }).then((n) => {
      if (!n) return;
      notesOf.set(id, n);
      emit(id);
      if (live) refresh();
    });
    return () => {
      live = false;
    };
  }, [node.id, originKey]);
  const notes = notesOf.get(node.id) ?? NO_NOTES;
  /** One change of the notes; the screen shows what the server answers. */
  async function changeNotes(op: NotesOp): Promise<NodeNotes | null> {
    const id = node.id;
    const next = await fetchNotes(origin, id, op);
    if (next) {
      notesOf.set(id, next);
      emit(id);
      refresh();
    }
    return next;
  }
  const removeSuggestion = (s: Suggestion) =>
    changeNotes(
      s.origin === "chat"
        ? { action: "unsave", id: s.id }
        : { action: "dismiss", command: s.command, reason: s.reason },
    );
  // What the suggestions tab and the chat show: generated minus removed.
  const shown: Loaded<Suggestion[]> =
    suggestions.result.status === "ok"
      ? {
          ...suggestions.result,
          result: withoutDismissed(suggestions.result.result, notes),
        }
      : suggestions.result;

  // A new node starts with no marked lines; the tab stays, so a reader of summaries keeps reading summaries.
  // biome-ignore lint/correctness/useExhaustiveDependencies: node.id is the trigger, not a value read here
  useEffect(() => {
    setHighlighted(undefined);
  }, [node.id]);

  // Declared after the clearing effect, so a card that also changes the node keeps its mark.
  useEffect(() => {
    if (mark) {
      setHighlighted(new Set([mark.line]));
      setTab("code");
    }
  }, [mark]);

  const name = title ?? provisionalLabel(node, t);

  const io = summary.result.status === "ok" ? summary.result.result : null;
  const count =
    (shown.status === "ok" ? shown.result.length : 0) + notes.saved.length;
  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "code", label: t("panel.tabCode") },
    ...(kind !== null
      ? [{ id: "chat" as const, label: t("panel.tabChat") }]
      : []),
    { id: "summary", label: t("panel.tabSummary") },
    ...(kind !== null
      ? [{ id: "suggestions" as const, label: t("panel.suggestions"), count }]
      : []),
  ];
  return (
    <aside className="panel detail-panel" aria-label={t("panel.aria")}>
      <h2>{name}</h2>
      <Tabs
        tabs={tabs}
        current={tab}
        onChange={setTab}
        label={t("panel.tabsAria")}
      />
      <section
        role="tabpanel"
        id="panel-code"
        aria-labelledby="tab-code"
        className="tab-body"
        hidden={tab !== "code"}
      >
        <h3 className="eyebrow">
          {codeHeading(filePath ?? snippetFile ?? t("snippet.file"), node, t)}
        </h3>
        {source !== undefined ? (
          <CodeView
            code={nodeCode(source, node)}
            start={node.range.start}
            highlightedLines={highlighted}
            file={filePath ?? snippetFile}
          />
        ) : onRetry ? (
          <div role="alert" className="code-failed">
            <p>{t("flow.loadFailed")}</p>
            <button type="button" className="btn-ghost" onClick={onRetry}>
              {t("flow.retry")}
            </button>
          </div>
        ) : (
          <p role="status">{t("panel.codeLoading")}</p>
        )}
      </section>
      <section
        role="tabpanel"
        id="panel-summary"
        aria-labelledby="tab-summary"
        className="tab-body"
        hidden={tab !== "summary"}
      >
        {kind !== null && <p className="eyebrow">{t("panel.eyebrow")}</p>}
        {kind !== null && (
          <SummaryView
            result={summary.result}
            onAsk={summary.ask}
            onStart={() => runInChat("summary")}
            onOpenSettings={onOpenSettings}
            claudeMissing={claudeMissing}
            onMark={showLines}
          />
        )}
        {kind !== null && explainStyle(kind) === "step" && (
          <p className="rules">{t("panel.rules")}</p>
        )}
        {io && (io.inputs.length > 0 || io.outputs.length > 0) && (
          <>
            <h3 className="eyebrow">{t("panel.io")}</h3>
            {/* SPEC_DEVIATION: a section, not a p (C13). Reason: Biome refuses aria-label on a p. */}
            <section className="io" aria-label={t("panel.ioAria")}>
              <IoClaims claims={io.inputs} onMark={showLines} />{" "}
              <span className="arrow">→</span>{" "}
              <IoClaims claims={io.outputs} onMark={showLines} />
            </section>
          </>
        )}
        {(node.kind === "file" ||
          node.kind === "function" ||
          node.kind === "class" ||
          node.kind === "module") && <EffectsView effects={effects} />}
      </section>
      {kind !== null && (
        <section
          role="tabpanel"
          id="panel-suggestions"
          aria-labelledby="tab-suggestions"
          className="tab-body"
          hidden={tab !== "suggestions"}
        >
          <SuggestionsView
            result={shown}
            saved={notes.saved}
            onRemove={removeSuggestion}
            onAsk={suggestions.ask}
            onStart={() => runInChat("suggestions")}
            onOpenSettings={onOpenSettings}
            claudeMissing={claudeMissing}
            onMark={showLines}
          />
        </section>
      )}
      {kind !== null && (
        <section
          role="tabpanel"
          id="panel-chat"
          aria-labelledby="tab-chat"
          className="tab-body"
          hidden={tab !== "chat"}
        >
          <ChatTab
            key={node.id}
            command={command}
            node={node}
            origin={origin}
            store={cache?.chat}
            renderPart={(part) =>
              part === "summary" ? (
                <SummaryView
                  result={summary.result}
                  onAsk={summary.ask}
                  onOpenSettings={onOpenSettings}
                  claudeMissing={claudeMissing}
                  onMark={showLines}
                />
              ) : (
                <SuggestionsView
                  result={shown}
                  saved={notes.saved}
                  onRemove={removeSuggestion}
                  onAsk={suggestions.ask}
                  onOpenSettings={onOpenSettings}
                  claudeMissing={claudeMissing}
                  onMark={showLines}
                />
              )
            }
            askPart={(part) => {
              const p = part === "summary" ? summary : suggestions;
              if (p.result.status !== "ok" && p.result.status !== "loading") {
                p.ask();
              }
            }}
            onMark={showLines}
            onOpenSettings={onOpenSettings}
            claudeMissing={claudeMissing}
            savedIds={new Set(notes.saved.map((x) => x.id))}
            onSave={async (suggestion) => {
              const next = await changeNotes({ action: "save", suggestion });
              const key = suggestionKey(suggestion);
              return (
                next?.saved.find((x) => suggestionKey(x) === key)?.id ?? null
              );
            }}
            onUnsave={async (id) =>
              (await changeNotes({ action: "unsave", id })) !== null
            }
          />
        </section>
      )}
    </aside>
  );
}

/** A shortcut the panel asks the chat to run, for one node. */
export interface ChatCommand {
  part: ExplainPart;
  nodeId: NodeId;
  nonce: number;
}

type TabId = "summary" | "code" | "suggestions" | "chat";

/** The panel's tabs; the arrow keys move between them. */
function Tabs({
  tabs,
  current,
  onChange,
  label,
}: {
  tabs: { id: TabId; label: string; count?: number }[];
  current: TabId;
  onChange: (id: TabId) => void;
  label: string;
}) {
  const move = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    const next = tabs[(i + step + tabs.length) % tabs.length];
    if (!next) return;
    e.preventDefault();
    onChange(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };
  return (
    <div className="panel-tabs" role="tablist" aria-label={label}>
      {tabs.map((tb, i) => (
        <button
          key={tb.id}
          type="button"
          role="tab"
          id={`tab-${tb.id}`}
          aria-selected={tb.id === current}
          aria-controls={`panel-${tb.id}`}
          tabIndex={tb.id === current ? 0 : -1}
          onClick={() => onChange(tb.id)}
          onKeyDown={(e) => move(e, i)}
        >
          {tb.label}
          {tb.count !== undefined && tb.count > 0 && (
            <span className="tab-count">{tb.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

interface PartTarget {
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
  { origin, node, explains }: PartTarget,
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
  }, [target, explains, real, clicked, cache, part]);

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
      <span>
        <RichInline text={claim.text} />
      </span>
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
      return (
        <button type="button" className="ask" disabled>
          {loading}
        </button>
      );
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

/** A failed or unfaithful answer: the message, and the same button of the part, enabled again. */
function Failed({
  text,
  ask,
  onAsk,
}: {
  text: string;
  ask: string;
  onAsk: () => void;
}) {
  return (
    <div className="ask-state">
      <p>{text}</p>
      <button type="button" className="ask" onClick={onAsk}>
        {ask}
      </button>
    </div>
  );
}

function SummaryView({
  result,
  onAsk,
  onStart,
  onOpenSettings,
  claudeMissing,
  onMark,
}: {
  result: Loaded<Summary>;
  onAsk: () => void;
  /** What the button of an empty part does; the retry of a failure is `onAsk`. */
  onStart?: (() => void) | undefined;
  onOpenSettings: (() => void) | undefined;
  claudeMissing?: boolean | undefined;
  onMark: Mark;
}) {
  const t = useT();
  switch (result.status) {
    case "error":
      return (
        <Failed
          text={t("panel.summaryFail")}
          ask={t("panel.askSummary")}
          onAsk={onStart ?? onAsk}
        />
      );
    case "unfaithful":
      return (
        <Failed
          text={t("panel.unfaithful")}
          ask={t("panel.askSummary")}
          onAsk={onStart ?? onAsk}
        />
      );
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
          onAsk={onStart ?? onAsk}
          onOpenSettings={onOpenSettings}
          claudeMissing={claudeMissing}
        />
      );
  }
}

function SuggestionsView({
  result,
  saved,
  onRemove,
  onAsk,
  onStart,
  onOpenSettings,
  claudeMissing,
  onMark,
}: {
  result: Loaded<Suggestion[]>;
  /** The ones kept from the chat. */
  saved: Suggestion[];
  onRemove: (s: Suggestion) => void;
  onAsk: () => void;
  onStart?: (() => void) | undefined;
  onOpenSettings: (() => void) | undefined;
  claudeMissing?: boolean | undefined;
  onMark: Mark;
}) {
  const t = useT();
  return (
    <section className="suggestions">
      {result.status === "ok" ? (
        <SuggestionList
          suggestions={result.result}
          onMark={onMark}
          onRemove={onRemove}
          // The tab is not empty when the chat kept something.
          quietEmpty={saved.length > 0}
        />
      ) : result.status === "error" || result.status === "unfaithful" ? (
        <Failed
          text={t("panel.suggestionsFail")}
          ask={t("panel.askSuggestions")}
          onAsk={onStart ?? onAsk}
        />
      ) : (
        <PartState
          result={result}
          ask={t("panel.askSuggestions")}
          loading={t("panel.loadingSuggestions")}
          onAsk={onStart ?? onAsk}
          onOpenSettings={onOpenSettings}
          claudeMissing={claudeMissing}
        />
      )}
      {saved.length > 0 && (
        <>
          <h3 className="eyebrow">{t("panel.fromChat")}</h3>
          <SuggestionList
            suggestions={saved}
            onMark={onMark}
            onRemove={onRemove}
          />
        </>
      )}
    </section>
  );
}

/** The generated suggestions the person did not remove. */
function withoutDismissed(list: Suggestion[], notes: NodeNotes): Suggestion[] {
  return list.filter((s) => !notes.dismissed.includes(suggestionKey(s)));
}

function SuggestionList({
  suggestions,
  onMark,
  onRemove,
  quietEmpty = false,
}: {
  suggestions: Suggestion[];
  onMark: Mark;
  onRemove: (s: Suggestion) => void;
  quietEmpty?: boolean;
}) {
  const t = useT();
  if (suggestions.length === 0) {
    return quietEmpty ? null : <p>{t("panel.noSuggestions")}</p>;
  }
  return (
    <ul>
      {suggestions.map((s) => (
        <li key={s.id} data-claim-id={s.id}>
          <button type="button" onClick={() => onMark(new Set([s.line]))}>
            <RichInline
              text={t("panel.suggestionItem", {
                command: s.command,
                line: s.line,
                severity: t(`severity.${s.severity}` as MessageKey),
              })}
            />
          </button>
          <span>
            <RichInline text={s.reason} />
          </span>
          <Evidence lines={s.lines} onMark={onMark} />
          <button
            type="button"
            className="remove-btn"
            aria-label={t("panel.removeSuggestion")}
            title={t("panel.removeSuggestion")}
            onClick={() => onRemove(s)}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
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
