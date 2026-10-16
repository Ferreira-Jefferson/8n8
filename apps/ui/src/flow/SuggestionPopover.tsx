import type { NodeId } from "@8n8/model";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { plural, useT } from "../i18n";
import { RichInline } from "../panel/Rich";
import type { SuggestionCardModel } from "./suggestion-cards";

/** The icon buttons sit 24 px from the top and are 60 px tall, plus a gap. */
const TOP_ROW = 96;

/** Where the badge sits, in flow coordinates: the middle of its top and bottom edges. */
export interface BadgeAnchor {
  x: number;
  top: number;
  bottom: number;
}

export interface SuggestionPopoverProps {
  cards: readonly SuggestionCardModel[];
  anchor: BadgeAnchor;
  /** The canvas zoom: the balloon keeps its screen size at any zoom. */
  zoom: number;
  onSuggestion: (explainedId: NodeId, line: number) => void;
  /** `byKey` is true on Esc, so the focus goes back to the badge. */
  onClose: (byKey: boolean) => void;
}

/** The balloon of a node's suggestion badge, with an arrow on the badge; a click on one opens the node at the line (VID-33). */
export function SuggestionPopover({
  cards,
  anchor,
  zoom,
  onSuggestion,
  onClose,
}: SuggestionPopoverProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(false);

  // Above the badge, as a map pin; below it when it would reach the row of
  // the breadcrumb and the icon buttons at the top of the canvas.
  useLayoutEffect(() => {
    const el = ref.current;
    const canvas = el?.closest(".canvas");
    if (!el || !canvas || below) return;
    const top = canvas.getBoundingClientRect().top + TOP_ROW;
    if (el.getBoundingClientRect().top < top) setBelow(true);
  }, [below]);

  useEffect(() => {
    ref.current
      ?.querySelector<HTMLButtonElement>(".pop-item")
      ?.focus({ preventScroll: true });
  }, []);

  const title = plural(t, "suggestion", cards.length);
  return (
    <div
      className="suggestion-pop-anchor nodrag nopan nowheel"
      style={{
        transform: `translate(${anchor.x}px, ${below ? anchor.bottom : anchor.top}px) scale(${1 / zoom})`,
      }}
    >
      <div
        ref={ref}
        className={`suggestion-pop ${below ? "below" : "above"}`}
        role="dialog"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          // Esc closes the balloon only, never the level behind it.
          e.stopPropagation();
          onClose(true);
        }}
      >
        <header className="pop-head">
          <b className="pop-title">{title}</b>
          <button
            type="button"
            className="pop-close"
            aria-label={t("suggestions.close")}
            onClick={() => onClose(false)}
          >
            ×
          </button>
        </header>
        <ul className="pop-list">
          {cards.map((card) => (
            <li key={card.key} className="pop-entry">
              <button
                type="button"
                className="pop-item"
                data-anchor-id={card.anchorId ?? "hub"}
                onClick={() => onSuggestion(card.explainedId, card.line)}
              >
                <span className="pop-command">
                  <span className={`pop-severity ${card.severity}`}>
                    {t(`severity.${card.severity}`)}
                  </span>{" "}
                  <RichInline text={card.text} />
                </span>
                <span className="pop-line">
                  {t("suggestions.line", { line: card.line })}
                </span>
                <span className="pop-reason">
                  <RichInline text={card.reason} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
