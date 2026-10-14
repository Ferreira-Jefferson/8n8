import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampPanel, PANEL_MIN, PanelResizer } from "../PanelResizer";

afterEach(cleanup);
beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1600,
  });
});

describe("PanelResizer", () => {
  it("keeps the panel between 320 px and 70% of the window", () => {
    expect(clampPanel(100)).toBe(PANEL_MIN);
    expect(clampPanel(600)).toBe(600);
    expect(clampPanel(1500)).toBe(1120);
  });

  it("widens the panel with the left arrow and narrows it with the right arrow", () => {
    const onResize = vi.fn();
    render(<PanelResizer width={500} onResize={onResize} />);
    const bar = screen.getByRole("separator", {
      name: "Redimensionar painel",
    });
    expect(bar.getAttribute("aria-valuenow")).toBe("500");
    fireEvent.keyDown(bar, { key: "ArrowLeft" });
    expect(onResize).toHaveBeenLastCalledWith(524);
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(onResize).toHaveBeenLastCalledWith(476);
  });
});
