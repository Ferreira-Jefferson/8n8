import { useT } from "../i18n";

/** The clock that opens the history drawer, at the top right of both screens. */
export function HistoryButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className="btn-ghost history-btn"
      aria-label={t("history.title")}
      aria-expanded={open}
      data-history-toggle=""
      onClick={onToggle}
    >
      <svg width="30" height="30" viewBox="0 0 28 28" aria-hidden="true">
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="14" cy="14" r="11" />
          <path d="M14 7v7l5 3" />
        </g>
      </svg>
    </button>
  );
}
