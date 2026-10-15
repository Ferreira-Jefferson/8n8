import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuggestionCard } from "../SuggestionCard";
import type { SuggestionCardModel } from "../suggestion-cards";

afterEach(cleanup);

const anchored: SuggestionCardModel = {
  key: "fn:processar_pedido:g1",
  explainedId: "fn:processar_pedido",
  anchorId: "fn:processar_pedido/s5",
  text: "Grave o pedido numa transação",
  line: 12,
};

describe("SuggestionCard (VID-31, VID-33)", () => {
  it("shows the command with a dot and the anchor in data-anchor-id", () => {
    const { container } = render(
      <SuggestionCard card={anchored} onSuggestion={() => {}} />,
    );
    const button = screen.getByRole("button", {
      name: "Grave o pedido numa transação",
    });
    expect(button.classList.contains("alert")).toBe(true);
    expect(button.getAttribute("data-anchor-id")).toBe(
      "fn:processar_pedido/s5",
    );
    expect(container.querySelector(".alert > i.dot")).not.toBeNull();
  });

  it('uses data-anchor-id="frame" for a card stuck to the frame', () => {
    render(
      <SuggestionCard
        card={{ ...anchored, anchorId: null }}
        onSuggestion={() => {}}
      />,
    );
    expect(screen.getByRole("button").getAttribute("data-anchor-id")).toBe(
      "frame",
    );
  });

  it("calls onSuggestion(explainedId, line) once on click", () => {
    const onSuggestion = vi.fn();
    render(<SuggestionCard card={anchored} onSuggestion={onSuggestion} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSuggestion).toHaveBeenCalledTimes(1);
    expect(onSuggestion).toHaveBeenCalledWith("fn:processar_pedido", 12);
  });
});
