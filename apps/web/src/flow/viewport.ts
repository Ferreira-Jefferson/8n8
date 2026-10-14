import type { NodeId } from "@code2n8n/model";
import { NODE_HEIGHT, NODE_WIDTH, type Position } from "./layout";

/** Below this zoom the card text is too small to read (VID-03). */
export const MIN_START_ZOOM = 0.8;
/** Free space at the sides and at the bottom of the canvas. */
export const SIDE_PAD = 40;
/** Free space at the top, below "Voltar", the breadcrumb and "Novo código". */
export const TOP_PAD = 140;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * The first view of a level (VID-03, 10). The whole level fits when it can at
 * a zoom between 0.8 and 1. A wider level stays at 0.8 and starts at its first
 * card on the left; a taller one starts at its top. The rest is a pan away.
 */
export function startViewport(
  positions: ReadonlyMap<NodeId, Position>,
  width: number,
  height: number,
): Viewport {
  const ps = [...positions.values()];
  if (ps.length === 0) return { x: 0, y: 0, zoom: 1 };
  const minX = Math.min(...ps.map((p) => p.x));
  const minY = Math.min(...ps.map((p) => p.y));
  const w = Math.max(...ps.map((p) => p.x)) + NODE_WIDTH - minX;
  const h = Math.max(...ps.map((p) => p.y)) + NODE_HEIGHT - minY;
  const freeW = width - 2 * SIDE_PAD;
  const freeH = height - TOP_PAD - SIDE_PAD;
  const zoom = Math.min(
    1,
    Math.max(MIN_START_ZOOM, Math.min(freeW / w, freeH / h)),
  );
  const x =
    w * zoom <= freeW
      ? SIDE_PAD + (freeW - w * zoom) / 2 - minX * zoom
      : SIDE_PAD - minX * zoom;
  const y =
    h * zoom <= freeH
      ? TOP_PAD + (freeH - h * zoom) / 2 - minY * zoom
      : TOP_PAD - minY * zoom;
  return { x, y, zoom };
}

/**
 * The view that brings the card at `p` back into a canvas of `width` by
 * `height`, at the same zoom, or null when the card is already in view. The
 * canvas narrows when the panel opens, so a selected card can end up behind
 * it (VID-22, 25).
 */
export function revealViewport(
  v: Viewport,
  p: Position,
  width: number,
  height: number,
): Viewport | null {
  const w = NODE_WIDTH * v.zoom;
  const h = NODE_HEIGHT * v.zoom;
  const left = p.x * v.zoom + v.x;
  const top = p.y * v.zoom + v.y;
  const inX = left >= SIDE_PAD && left + w <= width - SIDE_PAD;
  const inY = top >= 0 && top + h <= height;
  if (inX && inY) return null;
  return {
    x: inX ? v.x : (width - w) / 2 - p.x * v.zoom,
    y: inY ? v.y : (height - h) / 2 - p.y * v.zoom,
    zoom: v.zoom,
  };
}
