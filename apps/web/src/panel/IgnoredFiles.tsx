import type { IgnoredFile, IgnoreReason } from "@8n8/model";
import { useState } from "react";

const REASONS: Record<IgnoreReason, string> = {
  "too-large": "maior que 1 MB",
  "not-utf8": "não está em UTF-8",
  unreadable: "não foi possível ler",
  symlink: "link simbólico não seguido",
};

/**
 * The files left out of the map: a warning icon whose hover says how many, and a click
 * opens the list with each reason. A file over 1 MB (up to 20 MB) can go on the map.
 * Nothing when no file was left out (PROJ-06, CLEAN-04..06).
 */
export function IgnoredFiles({
  ignored,
  onAdd,
}: {
  ignored: IgnoredFile[];
  onAdd: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (ignored.length === 0) return null;
  const count =
    ignored.length === 1
      ? "1 arquivo ignorado"
      : `${ignored.length} arquivos ignorados`;
  return (
    <div className="ignored">
      <button
        type="button"
        className="btn-ghost ignored-btn"
        aria-label={count}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="24" height="22" viewBox="0 0 24 22" aria-hidden="true">
          <path
            d="M12 2 22.5 20h-21Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M12 8.5v5.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="12" cy="17" r="1.3" fill="currentColor" />
        </svg>
        <span className="ignored-tip" aria-hidden="true">
          {count}
        </span>
      </button>
      {open && (
        <section aria-label="Arquivos ignorados" className="ignored-list">
          <h3>{count}</h3>
          <ul>
            {ignored.map((f) => (
              <li key={f.path}>
                <span className="ignored-path">{f.path}</span>
                <span className="ignored-reason">{REASONS[f.reason]}</span>
                {f.addable && (
                  <button
                    type="button"
                    className="btn-ghost ignored-add"
                    onClick={() => onAdd(f.path)}
                  >
                    Adicionar ao mapa
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
