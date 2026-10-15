/** The star that marks a saved map as a favourite: filled when on. */
export function StarButton({
  title,
  starred,
  onToggle,
}: {
  title: string;
  starred: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="star-btn"
      aria-pressed={starred}
      aria-label={
        starred ? `Tirar ${title} dos favoritos` : `Pôr ${title} nos favoritos`
      }
      onClick={onToggle}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"
          fill={starred ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
