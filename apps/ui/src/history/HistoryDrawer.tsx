import type { HistoryEntry, HistoryItem } from "@8n8/model";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteHistory,
  fetchHistory,
  fetchHistoryEntry,
  starHistory,
} from "../api";
import { tagLabel } from "../flow/card";
import { defaultT, plural, type Translate, useLocale, useT } from "../i18n";
import { StarButton } from "./StarButton";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "há 2 h": the age of a date in short form; older than a month shows the date. */
export function relativeDate(
  then: number,
  now = Date.now(),
  t: Translate = defaultT,
  locale = "pt-BR",
): string {
  const age = Math.max(0, now - then);
  if (age < MINUTE) return t("time.now");
  if (age < HOUR) return t("time.min", { n: Math.floor(age / MINUTE) });
  if (age < DAY) return t("time.hour", { n: Math.floor(age / HOUR) });
  if (age < 30 * DAY) return t("time.day", { n: Math.floor(age / DAY) });
  return new Date(then).toLocaleDateString(locale);
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sizes(item: HistoryItem, t: Translate): string {
  return [
    plural(t, "line", item.lines),
    plural(t, "file", item.files),
    plural(t, "node", item.nodes),
    humanBytes(item.bytes),
  ].join(" · ");
}

/** The saved searches: a search box, one row per map, a star and a delete per row. Esc and a click outside close it. */
export function HistoryDrawer({
  onClose,
  onOpenEntry,
}: {
  onClose: () => void;
  onOpenEntry: (entry: HistoryEntry) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const drawer = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    search.current?.focus();
    let live = true;
    fetchHistory().then(
      (list) => live && setItems(list),
      () => live && setError(t("history.errRead")),
    );
    return () => {
      live = false;
    };
  }, [t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (
        target &&
        !drawer.current?.contains(target) &&
        !target.closest("[data-history-toggle]")
      ) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    // Capture: the map pane (d3-zoom) stops the mousedown before it bubbles up.
    document.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!items || q === "") return items;
    return items.filter((i) =>
      `${i.title} ${i.root ?? ""}`.toLowerCase().includes(q),
    );
  }, [items, query]);

  async function open(item: HistoryItem) {
    try {
      onOpenEntry(await fetchHistoryEntry(item.id));
    } catch {
      setError(t("history.errOpen"));
    }
  }

  async function remove(item: HistoryItem) {
    try {
      await deleteHistory(item.id);
      setItems((prev) => prev?.filter((i) => i.id !== item.id) ?? null);
    } catch {
      setError(t("history.errDelete"));
    }
  }

  async function star(item: HistoryItem) {
    try {
      await starHistory(item.id, !item.starred);
      setItems(
        (prev) =>
          prev?.map((i) =>
            i.id === item.id ? { ...i, starred: !item.starred } : i,
          ) ?? null,
      );
    } catch {
      setError(t("history.errStar"));
    }
  }

  const tag = (item: HistoryItem) =>
    item.kind === "project" ? "PASTA" : "TRECHO";

  return (
    <aside
      ref={drawer}
      className="history-drawer"
      aria-label={t("history.title")}
    >
      <input
        ref={search}
        type="search"
        aria-label={t("history.searchAria")}
        placeholder={t("history.searchPlaceholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
      />
      {error !== null && <p role="alert">{error}</p>}
      {items !== null && items.length === 0 && (
        <p className="history-empty">{t("history.none")}</p>
      )}
      {shown !== null && shown.length > 0 && (
        <ul>
          {shown.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="history-open"
                onClick={() => open(item)}
              >
                <span className="history-title">{item.title}</span>
                <span className="history-meta">
                  <span className="history-tag" data-tag={tag(item)}>
                    {tagLabel(tag(item), t)}
                  </span>
                  <span>
                    {relativeDate(item.openedAt, Date.now(), t, locale)}
                  </span>
                </span>
                <span className="history-sizes">{sizes(item, t)}</span>
              </button>
              <span className="history-actions">
                <StarButton
                  title={item.title}
                  starred={item.starred}
                  onToggle={() => star(item)}
                />
                <button
                  type="button"
                  className="history-delete"
                  aria-label={t("history.delete", { title: item.title })}
                  title={t("history.delete", { title: item.title })}
                  onClick={() => remove(item)}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7M10.2 10.5v5.5M13.8 10.5v5.5" />
                  </svg>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {items !== null && items.length > 0 && shown?.length === 0 && (
        <p className="history-empty">{t("history.noMatch")}</p>
      )}
    </aside>
  );
}
