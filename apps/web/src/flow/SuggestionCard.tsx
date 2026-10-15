import type { NodeId } from "@8n8/model";
import type { CSSProperties } from "react";
import type { SuggestionCardModel } from "./suggestion-cards";

export interface SuggestionCardProps {
  card: SuggestionCardModel;
  onSuggestion: (explainedId: NodeId, line: number) => void;
  style?: CSSProperties | undefined;
}

/** A light card with the suggestion's command; a click opens the explained node at the line (VID-31, 33). */
export function SuggestionCard({
  card,
  onSuggestion,
  style,
}: SuggestionCardProps) {
  return (
    <button
      type="button"
      className="alert"
      data-anchor-id={card.anchorId ?? "frame"}
      style={style}
      onClick={() => onSuggestion(card.explainedId, card.line)}
    >
      <i className="dot" aria-hidden="true" />
      {card.text}
    </button>
  );
}
