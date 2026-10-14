/** The hamburger that opens the history drawer, at the top right of both screens. */
export function HistoryButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="btn-ghost history-btn"
      aria-label="Histórico"
      aria-expanded={open}
      data-history-toggle=""
      onClick={onToggle}
    >
      <svg width="28" height="22" viewBox="0 0 28 22" aria-hidden="true">
        <path
          d="M2 3h24M2 11h24M2 19h24"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
