import type { HistoryEntry, HistoryItem } from "@code2n8n/model";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteHistory,
  fetchHistory,
  fetchHistoryEntry,
  starHistory,
} from "../api";
import { StarButton } from "./StarButton";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "há 2 h": the age of a date in short pt-BR form; older than a month shows the date. */
export function relativeDate(then: number, now = Date.now()): string {
  const age = Math.max(0, now - then);
  if (age < MINUTE) return "agora";
  if (age < HOUR) return `há ${Math.floor(age / MINUTE)} min`;
  if (age < DAY) return `há ${Math.floor(age / HOUR)} h`;
  if (age < 30 * DAY) return `há ${Math.floor(age / DAY)} d`;
  return new Date(then).toLocaleDateString("pt-BR");
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function sizes(item: HistoryItem): string {
  return [
    count(item.lines, "linha", "linhas"),
    count(item.files, "arquivo", "arquivos"),
    count(item.nodes, "nó", "nós"),
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
      () => live && setError("Não foi possível ler o histórico."),
    );
    return () => {
      live = false;
    };
  }, []);

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
      setError("Não foi possível abrir a pesquisa.");
    }
  }

  async function remove(item: HistoryItem) {
    try {
      await deleteHistory(item.id);
      setItems((prev) => prev?.filter((i) => i.id !== item.id) ?? null);
    } catch {
      setError("Não foi possível apagar a pesquisa.");
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
      setError("Não foi possível marcar o favorito.");
    }
  }

  const tag = (item: HistoryItem) =>
    item.kind === "project" ? "PASTA" : "TRECHO";

  return (
    <aside ref={drawer} className="history-drawer" aria-label="Histórico">
      <input
        ref={search}
        type="search"
        aria-label="Buscar no histórico"
        placeholder="Buscar pesquisa"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
      />
      {error !== null && <p role="alert">{error}</p>}
      {items !== null && items.length === 0 && (
        <p className="history-empty">Nenhuma pesquisa guardada.</p>
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
                    {tag(item)}
                  </span>
                  <span>{relativeDate(item.openedAt)}</span>
                </span>
                <span className="history-sizes">{sizes(item)}</span>
              </button>
              <StarButton
                title={item.title}
                starred={item.starred}
                onToggle={() => star(item)}
              />
              <button
                type="button"
                className="history-delete"
                aria-label={`Apagar ${item.title}`}
                onClick={() => remove(item)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {items !== null && items.length > 0 && shown?.length === 0 && (
        <p className="history-empty">Nada encontrado.</p>
      )}
    </aside>
  );
}
