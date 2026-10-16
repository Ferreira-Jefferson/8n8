import { type NodeId, searchWords } from "@8n8/model";
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
import { highlight, matchEntries, type SearchEntry } from "./match";

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
  onPick,
}: {
  entries: readonly SearchEntry[];
  onPick: (id: NodeId) => void;
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
  const results = useMemo(
    () => (open ? matchEntries(entries, query) : []),
    [open, entries, query],
  );
  const words = searchWords(query);

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
    onPick(entry.id);
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
                key={entry.id}
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
