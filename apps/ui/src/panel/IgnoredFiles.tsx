import type { IgnoredFile, IgnoreReason } from "@8n8/model";
import { useState } from "react";
import { type MessageKey, plural, type Translate, useT } from "../i18n";

const REASONS: Record<Exclude<IgnoreReason, "unsupported">, MessageKey> = {
  "too-large": "ignored.too-large",
  "not-utf8": "ignored.not-utf8",
  unreadable: "ignored.unreadable",
  symlink: "ignored.symlink",
  "output-folder": "ignored.output-folder",
};

/** Why a line of the list is off the map; an extension says how many files it has. */
function reasonOf(f: IgnoredFile, t: Translate): string {
  return f.reason === "unsupported"
    ? plural(t, "ignored.unsupported", f.count ?? 0)
    : t(REASONS[f.reason]);
}

/**
 * The files left out of the map: a warning icon whose hover says how many, and a click
 * opens the list with each reason. A file over 1 MB (up to 20 MB) can go on the map.
 * The list also names the build output folders it skipped and counts the files of
 * other languages by extension (G14). Nothing when nothing was left out (PROJ-06, CLEAN-04..06).
 */
export function IgnoredFiles({
  ignored,
  onAdd,
}: {
  ignored: IgnoredFile[];
  onAdd: (path: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (ignored.length === 0) return null;
  const onlyFiles = ignored.every(
    (f) => f.reason !== "output-folder" && f.reason !== "unsupported",
  );
  const count = plural(
    t,
    onlyFiles ? "ignored" : "ignoredItems",
    ignored.length,
  );
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
        <section aria-label={t("ignored.aria")} className="ignored-list">
          <h3>{count}</h3>
          <ul>
            {ignored.map((f) => (
              <li key={f.path}>
                <span className="ignored-path">{f.path}</span>
                <span className="ignored-reason">{reasonOf(f, t)}</span>
                {f.addable && (
                  <button
                    type="button"
                    className="btn-ghost ignored-add"
                    onClick={() => onAdd(f.path)}
                  >
                    {t("ignored.add")}
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
