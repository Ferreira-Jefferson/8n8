import { searchWords } from "@8n8/model";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useT } from "../i18n";
import {
  highlight,
  matchEntries,
  mergeResults,
  type SearchEntry,
} from "./match";

/** The search waits this long after the last key before it asks the server. */
const ASK_DELAY_MS = 150;

function Marked({ text, words }: { text: string; words: string[] }) {
  return highlight(text, words).map((part, i) =>
    part.hit ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one string never reorder
      <mark key={i}>{part.text}</mark>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one string never reorder
      <Fragment key={i}>{part.text}</Fragment>
    ),
  );
}

/**
 * The search for a node: a magnifier that grows into a field. It looks at the
 * title and at the technical name, in every level of the graph; a pick goes to
 * `onPick` and closes the search.
 */
export function NodeSearch({
  entries,
  remote,
  onPick,
}: {
  /** The nodes the screen holds, with their reviewed titles: they answer at once. */
  entries: readonly SearchEntry[];
  /** The nodes of the whole folder, from the server: they join the answer when they arrive. Keep it stable between renders. */
  remote?: ((query: string) => Promise<SearchEntry[]>) | undefined;
  onPick: (entry: SearchEntry) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const lupa = useRef<HTMLButtonElement>(null);
  const base = useId();
  const optionId = (i: number) => `${base}-${i}`;
  const [heard, setHeard] = useState<{
    query: string;
    entries: SearchEntry[];
  } | null>(null);
  const words = searchWords(query);
  const wordsKey = words.join(" ");
  // The server is asked after a pause; an answer to an old query is dropped.
  // biome-ignore lint/correctness/useExhaustiveDependencies: wordsKey stands for the query
  useEffect(() => {
    if (!open || !remote || wordsKey === "") return;
    let live = true;
    const timer = window.setTimeout(() => {
      remote(query)
        .then((list) => {
          if (live) setHeard({ query: wordsKey, entries: list });
        })
        .catch(() => {});
    }, ASK_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [open, remote, wordsKey]);
  const results = useMemo(
    () =>
      open
        ? mergeResults(
            matchEntries(entries, query),
            heard?.query === wordsKey ? heard.entries : [],
          )
        : [],
    [open, entries, query, heard, wordsKey],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(-1);
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open, close]);

  function pick(entry: SearchEntry | undefined) {
    if (!entry) return;
    close();
    onPick(entry);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      close();
      lupa.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + step + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(results[Math.max(active, 0)]);
    }
  }

  return (
    <div ref={root} className={open ? "node-search open" : "node-search"}>
      <div className="search-field">
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label={t("search.aria")}
          aria-expanded={open}
          aria-controls={`${base}-list`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          placeholder={t("search.placeholder")}
          autoComplete="off"
          spellCheck={false}
          tabIndex={open ? 0 : -1}
          onKeyDown={onKeyDown}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(-1);
          }}
        />
        <button
          ref={lupa}
          type="button"
          className="search-lupa"
          aria-label={t("search.aria")}
          aria-expanded={open}
          aria-controls={`${base}-list`}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <svg width="30" height="30" viewBox="0 0 28 28" aria-hidden="true">
            <g
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="8" />
              <path d="M18 18l6 6" />
            </g>
          </svg>
        </button>
      </div>
      {open && (
        <div className="search-results">
          <div id={`${base}-list`} role="listbox" aria-label={t("search.list")}>
            {results.map((entry, i) => (
              <button
                key={`${entry.id} ${entry.title}`}
                id={optionId(i)}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                className={i === active ? "search-res on" : "search-res"}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(entry)}
              >
                <b className="search-title">
                  <Marked text={entry.title} words={words} />
                </b>
                <span className="search-meta">
                  <em>
                    <Marked text={entry.tech} words={words} />
                  </em>
                  <i>{entry.where}</i>
                </span>
              </button>
            ))}
          </div>
          {results.length === 0 && (
            <p className="search-none">{t("search.none")}</p>
          )}
        </div>
      )}
    </div>
  );
}
