import {
  CHAT_MAX_QUESTION_CHARS,
  CHAT_MAX_TURNS,
  type ChatSuggestion,
  type ChatTurn,
  type ExplainPart,
  type FlowNode,
  type NodeId,
} from "@8n8/model";
import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type ExplainOrigin, fetchChat, fetchStructure } from "../api";
import { useT } from "../i18n";
import { type PlainRenderer, Rich } from "./Rich";

/** One bubble of the conversation. A summary or suggestions bubble shows the node's own part, so it stays in step with the Resumo and Sugestões tabs. */
export type ChatEntry =
  | { role: "user"; kind: "text"; text: string; command?: ExplainPart }
  | {
      role: "assistant";
      kind: "text";
      text: string;
      /** What the model, or the structuring, found in this answer. */
      suggestion?: ChatSuggestion | undefined;
      /** Set while the suggestion is kept in the notes of the node. */
      savedId?: string | undefined;
      /** Why nothing was kept, when the person asked and there was nothing to keep. */
      note?: "none" | "failed" | undefined;
    }
  | { role: "assistant"; kind: "part"; part: ExplainPart }
  | { role: "assistant"; kind: "no-key" }
  | { role: "assistant"; kind: "failed"; message: string; question: string };

export interface ChatTabProps {
  node: FlowNode;
  /** A shortcut the panel asks to run, once per nonce and only for this node. */
  command?: { part: ExplainPart; nodeId: NodeId; nonce: number } | undefined;
  origin: ExplainOrigin;
  /** What this map already talked, by node; the tab reads it and adds to it. */
  store?: Map<NodeId, ChatEntry[]> | undefined;
  /** The node's own summary or suggestions, as the panel shows them. */
  renderPart: (part: ExplainPart) => ReactNode;
  /** Asks the part for real, unless it is already there or on its way. */
  askPart: (part: ExplainPart) => void;
  /** A line the answer points at: the code tab marks it. */
  onMark: (lines: ReadonlySet<number>) => void;
  onOpenSettings?: (() => void) | undefined;
  claudeMissing?: boolean | undefined;
  /** The ids of the suggestions kept from the chat that are still kept (the person can remove one in the list). */
  savedIds: ReadonlySet<string>;
  /** Keeps a suggestion; gives its id, or null when the server refused. */
  onSave: (suggestion: ChatSuggestion) => Promise<string | null>;
  onUnsave: (id: string) => Promise<boolean>;
}

type TextEntry = Extract<ChatEntry, { role: "assistant"; kind: "text" }>;

const COMMANDS: Record<string, ExplainPart> = {
  "/resumo": "summary",
  "/summary": "summary",
  "/sugestoes": "suggestions",
  "/sugestao": "suggestions",
  "/suggestions": "suggestions",
};

/** `/resumo` or `/sugestões`, with or without accents; anything else is a question. */
export function commandOf(text: string): ExplainPart | null {
  const word = text.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return COMMANDS[word] ?? null;
}

/** The text turns the server gets as the past: no command, no part, no failure; the last ones only. */
function historyOf(entries: ChatEntry[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const e of entries) {
    if (e.kind !== "text" || (e.role === "user" && e.command)) continue;
    turns.push({ role: e.role, content: e.text });
  }
  return turns.slice(-CHAT_MAX_TURNS);
}

/** An answer with `L12` marks: each one inside the node becomes a button that marks the line in the code. The Markdown marks around it are shaped. */
function WithLines({
  text,
  node,
  onMark,
}: {
  text: string;
  node: FlowNode;
  onMark: (lines: ReadonlySet<number>) => void;
}) {
  const plain: PlainRenderer = (piece, key) => (
    <Fragment key={key}>
      {piece.split(/\b(L\d+)\b/).map((part, i) => {
        const n = /^L(\d+)$/.exec(part)?.[1];
        const line = n === undefined ? NaN : Number(n);
        const inside = line >= node.range.start && line <= node.range.end;
        return inside ? (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: the pieces never reorder
            key={i}
            type="button"
            className="line-ref"
            onClick={() => onMark(new Set([line]))}
          >
            {part}
          </button>
        ) : (
          part
        );
      })}
    </Fragment>
  );
  return <Rich text={text} plain={plain} />;
}

/** Under an answer: the icon that keeps it as a suggestion (and takes it back), and what happened. */
function SaveBar({
  entry,
  kept,
  busy,
  onToggle,
}: {
  entry: TextEntry;
  kept: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const label = t(kept ? "chat.unsaveSuggestion" : "chat.saveSuggestion");
  return (
    <div className={kept ? "msg-actions kept" : "msg-actions"}>
      {kept && <span className="save-note">{t("chat.savedNote")}</span>}
      {!kept && entry.note === "none" && (
        <span className="save-note">{t("chat.noSuggestionFound")}</span>
      )}
      {!kept && entry.note === "failed" && (
        <span className="save-note">{t("chat.failed")}</span>
      )}
      <button
        type="button"
        className={kept ? "save-btn on" : "save-btn"}
        aria-pressed={kept}
        aria-label={label}
        title={label}
        disabled={busy}
        onClick={onToggle}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"
            fill={kept ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

/** The conversation about one node and its parent: questions, short answers, and the two shortcuts for the summary and the suggestions. */
export function ChatTab({
  node,
  command,
  origin,
  store,
  renderPart,
  askPart,
  onMark,
  onOpenSettings,
  claudeMissing,
  savedIds,
  onSave,
  onUnsave,
}: ChatTabProps) {
  const t = useT();
  const local = useRef(new Map<NodeId, ChatEntry[]>());
  const memory = store ?? local.current;
  const [entries, setEntries] = useState<ChatEntry[]>(
    () => memory.get(node.id) ?? [],
  );
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState("");
  const live = useRef(true);
  const log = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // The field grows with the text, up to a limit; past it, it scrolls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the text is the trigger, the height is read from the element
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [draft]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new bubble is the trigger, the list is not read
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, pending]);

  const handled = useRef(command?.nonce ?? 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the nonce is the trigger; runCommand reads the bubbles of this render
  useEffect(() => {
    if (!command || command.nodeId !== node.id) return;
    if (command.nonce === handled.current) return;
    handled.current = command.nonce;
    runCommand(command.part, commandLabel(command.part));
  }, [command?.nonce]);

  const commit = (next: ChatEntry[]) => {
    memory.set(node.id, next);
    if (live.current) setEntries(next);
  };

  /** Changes one answer, also when the tab closed meanwhile: the store is the truth. */
  const patch = (index: number, change: Partial<TextEntry>) =>
    commit(
      (memory.get(node.id) ?? []).map((e, i) =>
        i === index && e.role === "assistant" && e.kind === "text"
          ? { ...e, ...change }
          : e,
      ),
    );
  const [saving, setSaving] = useState<number | null>(null);

  function ask(question: string, past: ChatEntry[]) {
    const withQuestion: ChatEntry[] = [
      ...past,
      { role: "user", kind: "text", text: question },
    ];
    commit(withQuestion);
    setPending(true);
    fetchChat(origin, node.id, historyOf(past), question).then((r) => {
      const reply: ChatEntry =
        r.status === "ok"
          ? {
              role: "assistant",
              kind: "text",
              text: r.reply,
              suggestion: r.suggestion,
            }
          : r.status === "no-key"
            ? { role: "assistant", kind: "no-key" }
            : {
                role: "assistant",
                kind: "failed",
                message: r.status === "stale" ? t("panel.stale") : r.message,
                question,
              };
      commit([...withQuestion, reply]);
      if (live.current) setPending(false);
      // A suggestion the model found is kept at once; the person can undo it.
      if (r.status === "ok" && r.suggestion) {
        const at = withQuestion.length;
        onSave(r.suggestion).then((id) => {
          if (id) patch(at, { savedId: id });
        });
      }
    });
  }

  /** The icon of an answer: keeps it as a suggestion, or removes it from them. */
  async function toggleSave(index: number, entry: TextEntry) {
    setSaving(index);
    try {
      if (entry.savedId !== undefined && savedIds.has(entry.savedId)) {
        if (await onUnsave(entry.savedId)) patch(index, { savedId: undefined });
        return;
      }
      let suggestion = entry.suggestion;
      if (!suggestion) {
        const found = await fetchStructure(origin, node.id, entry.text);
        if (found.status !== "ok") {
          patch(index, { note: found.status === "none" ? "none" : "failed" });
          return;
        }
        suggestion = found.suggestion;
        patch(index, { suggestion, note: undefined });
      }
      const id = await onSave(suggestion);
      patch(index, id ? { savedId: id, note: undefined } : { note: "failed" });
    } finally {
      setSaving(null);
    }
  }

  function runCommand(part: ExplainPart, label: string) {
    askPart(part);
    commit([
      ...entries,
      { role: "user", kind: "text", text: label, command: part },
      { role: "assistant", kind: "part", part },
    ]);
  }

  const commandLabel = (part: ExplainPart) =>
    t(part === "summary" ? "chat.cmdSummary" : "chat.cmdSuggestions");

  function send() {
    const text = draft.trim();
    if (text === "" || pending) return;
    setDraft("");
    const command = commandOf(text);
    if (command) runCommand(command, text);
    else ask(text, entries);
  }

  function retry(failed: Extract<ChatEntry, { kind: "failed" }>) {
    // Drops the failure and the question it answered, then asks again.
    const past = entries.slice(0, -2);
    ask(failed.question, past);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  }

  const shortcuts = (["summary", "suggestions"] as const).map((part) => (
    <button
      key={part}
      type="button"
      className="chat-chip"
      disabled={pending}
      onClick={() => runCommand(part, commandLabel(part))}
    >
      {commandLabel(part)}
    </button>
  ));

  return (
    <div className="chat">
      <div
        ref={log}
        className="chat-log"
        role="log"
        aria-label={t("chat.aria")}
        aria-live="polite"
      >
        {entries.length === 0 && (
          <div className="chat-empty">
            <p>{t("chat.empty")}</p>
          </div>
        )}
        {entries.map((e, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: bubbles are only ever added at the end
          <article key={i} className={`msg ${e.role}`} data-kind={e.kind}>
            {e.kind === "text" &&
              (e.role === "assistant" ? (
                <>
                  <WithLines text={e.text} node={node} onMark={onMark} />
                  <SaveBar
                    entry={e}
                    kept={e.savedId !== undefined && savedIds.has(e.savedId)}
                    busy={saving === i}
                    onToggle={() => toggleSave(i, e)}
                  />
                </>
              ) : (
                <p>{e.text}</p>
              ))}
            {e.kind === "part" && renderPart(e.part)}
            {e.kind === "no-key" && (
              <div className="explanation-state">
                <p>
                  {t(claudeMissing ? "panel.claudeMissing" : "panel.noKey")}
                </p>
                {onOpenSettings && (
                  <button type="button" onClick={onOpenSettings}>
                    {t("panel.openSettings")}
                  </button>
                )}
              </div>
            )}
            {e.kind === "failed" && (
              <div className="explanation-state">
                <p>{e.message}</p>
                {i === entries.length - 1 && (
                  <button type="button" onClick={() => retry(e)}>
                    {t("panel.retry")}
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
        {pending && (
          <article className="msg assistant" data-kind="pending">
            <p className="typing" role="status">
              {t("chat.thinking")}
            </p>
          </article>
        )}
      </div>
      <div className="chat-composer">
        <textarea
          ref={field}
          rows={1}
          value={draft}
          maxLength={CHAT_MAX_QUESTION_CHARS}
          placeholder={t("chat.placeholder")}
          aria-label={t("chat.placeholder")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="chat-bar">
          <div className="chat-chips">{shortcuts}</div>
          <button
            type="button"
            className="chat-send"
            aria-label={t("chat.send")}
            title={t("chat.send")}
            disabled={pending || draft.trim() === ""}
            onClick={send}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M12 19V5M5 12l7-7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
