import type { KeyboardEvent, PointerEvent } from "react";

export const PANEL_MIN = 320;
const STEP = 24;
/** The panel's horizontal margins (24 px each side) sit inside its grid column. */
const MARGINS = 48;

/** The widest panel: the canvas keeps at least 30% of the window. */
export function panelMax(): number {
  return Math.round(window.innerWidth * 0.7);
}

export function clampPanel(width: number): number {
  return Math.min(Math.max(width, PANEL_MIN), panelMax());
}

/** Width of the panel's grid column: the panel after the bar, plus its margins. */
function columnWidth(bar: HTMLElement): number {
  const panel = bar.nextElementSibling;
  return (panel?.getBoundingClientRect().width ?? PANEL_MIN) + MARGINS;
}

/** The bar between the canvas and the panel: drag it, or use the arrows, to resize the panel. */
export function PanelResizer({
  width,
  onResize,
}: {
  /** Current panel width in px; undefined while it keeps the CSS default. */
  width: number | undefined;
  onResize: (width: number) => void;
}) {
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const bar = e.currentTarget;
    bar.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = columnWidth(bar);
    const move = (m: globalThis.PointerEvent) =>
      onResize(clampPanel(startWidth + startX - m.clientX));
    const up = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      bar.removeEventListener("pointercancel", up);
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
    bar.addEventListener("pointercancel", up);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = width ?? columnWidth(e.currentTarget);
    if (e.key === "ArrowLeft") onResize(clampPanel(current + STEP));
    else if (e.key === "ArrowRight") onResize(clampPanel(current - STEP));
    else return;
    e.preventDefault();
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: an hr cannot take focus or be dragged
    <div
      className="panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionar painel"
      aria-valuemin={PANEL_MIN}
      aria-valuemax={panelMax()}
      aria-valuenow={width === undefined ? undefined : Math.round(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
