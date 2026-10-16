import type { HistoryEntry, HistoryItem } from "@8n8/model";
import { useEffect, useState } from "react";
import { fetchHistory, fetchHistoryEntry, starHistory } from "../api";
import { relativeDate } from "../history/HistoryDrawer";
import { StarButton } from "../history/StarButton";

const RECENT = 5;

function FolderIcon() {
  return (
    <svg
      className="home-icon"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg
      className="home-icon"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function detail(item: HistoryItem): string {
  const where = item.kind === "project" ? (item.root ?? "Pasta") : "Trecho";
  const nodes = item.nodes === 1 ? "1 nó" : `${item.nodes} nós`;
  return `${where} · ${nodes} · ${relativeDate(item.openedAt)}`;
}

/** The launcher: open a folder or paste a snippet on the left; favourites and recent maps on the right. */
export function Home({
  folder,
  onFolderChange,
  onOpenFolder,
  onPick,
  onPaste,
  onOpenEntry,
  onShowHistory,
  historyOpen,
  reads,
}: {
  /** What the app reads from a folder, as a sentence (from the server's languages). */
  reads: string;
  folder: string;
  onFolderChange: (path: string) => void;
  onOpenFolder: () => void;
  /** Opens the system chooser for a folder or a file; the caller maps the choice. */
  onPick: (kind: "folder" | "file") => void;
  onPaste: () => void;
  onOpenEntry: (entry: HistoryEntry) => void;
  onShowHistory: () => void;
  /** While the drawer is open the lists wait; closing it reloads them (stars may have changed). */
  historyOpen: boolean;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    if (historyOpen) return;
    let live = true;
    fetchHistory().then(
      (list) => live && setItems(list),
      () => live && setError("Não foi possível ler o histórico."),
    );
    return () => {
      live = false;
    };
  }, [historyOpen]);

  async function open(item: HistoryItem) {
    try {
      onOpenEntry(await fetchHistoryEntry(item.id));
    } catch {
      setError("Não foi possível abrir o mapa.");
    }
  }

  async function star(item: HistoryItem) {
    try {
      await starHistory(item.id, !item.starred);
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, starred: !item.starred } : i,
        ),
      );
    } catch {
      setError("Não foi possível marcar o favorito.");
    }
  }

  const favorites = items.filter((i) => i.starred);
  const recent = items.filter((i) => !i.starred).slice(0, RECENT);

  const list = (label: string, shown: HistoryItem[]) => (
    <section className="home-list" aria-label={label}>
      <h2 className="home-label">{label}</h2>
      <ul>
        {shown.map((item) => (
          <li key={item.id} data-kind={item.kind}>
            <button
              type="button"
              className="home-open"
              onClick={() => open(item)}
            >
              {item.kind === "project" ? <FolderIcon /> : <CodeIcon />}
              <span className="home-item">
                <b>{item.title}</b>
                <small>{detail(item)}</small>
              </span>
            </button>
            <StarButton
              title={item.title}
              starred={item.starred}
              onToggle={() => star(item)}
            />
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="home-grid">
      <div className="home-start">
        <p className="home-title">O mapa do seu código.</p>
        <form
          className="home-card home-folder"
          aria-label="Abrir pasta"
          onSubmit={(e) => {
            e.preventDefault();
            // An empty field has nothing to map: offer the system chooser.
            if (folder.trim() === "") setChoosing(true);
            else onOpenFolder();
          }}
        >
          <h2 className="home-label">Abrir pasta</h2>
          <label className="home-field">
            <FolderIcon />
            <input
              type="text"
              aria-label="Caminho da pasta"
              placeholder="C:\projetos\loja"
              value={folder}
              onChange={(e) => {
                setChoosing(false);
                onFolderChange(e.target.value);
              }}
              spellCheck={false}
            />
          </label>
          {choosing ? (
            <div className="home-choose">
              <button
                type="button"
                className="home-btn"
                onClick={() => onPick("folder")}
              >
                Escolher pasta
              </button>
              <button
                type="button"
                className="home-btn"
                onClick={() => onPick("file")}
              >
                Escolher arquivo
              </button>
            </div>
          ) : (
            <button type="submit" className="home-btn">
              Mapear pasta
            </button>
          )}
          <small>{reads}</small>
        </form>
        <button
          type="button"
          className="home-card home-paste"
          onClick={onPaste}
        >
          <CodeIcon />
          <span className="home-item">
            <b>Colar trecho</b>
            <small>Mapeia um pedaço de código</small>
          </span>
        </button>
      </div>
      <div className="home-lists">
        {error !== null && <p role="alert">{error}</p>}
        {favorites.length > 0 && list("Favoritos", favorites)}
        {recent.length > 0 && list("Recentes", recent)}
        {items.length === 0 && (
          <p className="home-empty">
            Os mapas que você gerar aparecem aqui. Marque a estrela para guardar
            um mapa nos favoritos.
          </p>
        )}
        {items.length > 0 && (
          <button
            type="button"
            className="home-more"
            data-history-toggle=""
            aria-expanded={historyOpen}
            onClick={onShowHistory}
          >
            Ver todo o histórico
          </button>
        )}
      </div>
    </div>
  );
}
