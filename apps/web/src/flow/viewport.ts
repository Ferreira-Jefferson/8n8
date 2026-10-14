import type { NodeId } from "@code2n8n/model";
import { NODE_HEIGHT, NODE_WIDTH, type Position } from "./layout";

/** Below this zoom the card text is too small to read (VID-03). */
export const MIN_START_ZOOM = 0.8;
/** Free space at the sides and at the bottom of the canvas. */
export const SIDE_PAD = 40;
/** Free space at the top, below "Voltar", the breadcrumb and "Novo código". */
export const TOP_PAD = 140;
/**
 * The smallest zoom at which a whole level is shown: the 27 px card name stays
 * above 16 px on screen (VID-03).
 */
export const LEGIBLE_ZOOM = 0.6;
/** Free space at the sides and at the bottom of a level that fits whole. */
export const FIT_PAD = 24;
/** Free space at the sides of a wrapped level: its turning wires run 24 px out of the cards. */
export const WRAP_PAD = 48;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface Bounds {
  minX: number;
  minY: number;
  w: number;
  h: number;
}

function boundsOf(positions: ReadonlyMap<NodeId, Position>): Bounds | null {
  const ps = [...positions.values()];
  if (ps.length === 0) return null;
  const minX = Math.min(...ps.map((p) => p.x));
  const minY = Math.min(...ps.map((p) => p.y));
  return {
    minX,
    minY,
    w: Math.max(...ps.map((p) => p.x)) + NODE_WIDTH - minX,
    h: Math.max(...ps.map((p) => p.y)) + NODE_HEIGHT - minY,
  };
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
  const b = boundsOf(positions);
  if (!b) return { x: 0, y: 0, zoom: 1 };
  const { minX, minY, w, h } = b;
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
 * The largest zoom, at most 1, at which every card of the level fits the
 * canvas, `padX` from each side.
 */
export function fitZoom(
  positions: ReadonlyMap<NodeId, Position>,
  width: number,
  height: number,
  padX = FIT_PAD,
): number {
  const b = boundsOf(positions);
  if (!b) return 1;
  const freeW = width - 2 * padX;
  const freeH = height - TOP_PAD - FIT_PAD;
  if (freeW <= 0 || freeH <= 0) return 0;
  return Math.min(1, freeW / b.w, freeH / b.h);
}

/**
 * The view that shows every card of the level, or null when that zoom is
 * below `LEGIBLE_ZOOM` (VID-03, 23, 25). The level sits in the middle of the
 * free area. With `focus`, the level moves so that card comes as near the
 * middle as it can while every card stays in view (VID-27).
 */
export function fitViewport(
  positions: ReadonlyMap<NodeId, Position>,
  width: number,
  height: number,
  focus?: Position,
  padX = FIT_PAD,
): Viewport | null {
  const b = boundsOf(positions);
  if (!b) return null;
  const zoom = fitZoom(positions, width, height, padX);
  if (zoom < LEGIBLE_ZOOM) return null;
  const freeW = width - 2 * padX;
  const freeH = height - TOP_PAD - FIT_PAD;
  const place = (
    start: number,
    free: number,
    size: number,
    min: number,
    at: number | undefined,
    card: number,
  ) => {
    const slack = free - size * zoom;
    const centered = start + slack / 2;
    if (at === undefined) return centered - min * zoom;
    const wanted = start + free / 2 - (at - min + card / 2) * zoom;
    return Math.min(start + slack, Math.max(start, wanted)) - min * zoom;
  };
  return {
    x: place(padX, freeW, b.w, b.minX, focus?.x, NODE_WIDTH),
    y: place(TOP_PAD, freeH, b.h, b.minY, focus?.y, NODE_HEIGHT),
    zoom,
  };
}

/**
 * How many cards a row of a level holds, or null to keep the level as it is
 * (VID-03, 10, 23). `layoutFor(n)` lays the level out with rows of at most
 * `n` cards; `longest` is the longest row unwrapped.
 * - A level that fits whole at `LEGIBLE_ZOOM` or more keeps its shape.
 * - Otherwise the longest row length that fits at `MIN_START_ZOOM` or more.
 * - Otherwise the row length with the largest zoom, when that is legible.
 * - Otherwise the longest row that fills the canvas width at `MIN_START_ZOOM`.
 * A wrapped level is measured with `WRAP_PAD` at the sides.
 */
export function chooseWrap(
  longest: number,
  layoutFor: (n: number) => ReadonlyMap<NodeId, Position>,
  width: number,
  height: number,
): number | null {
  if (width <= 0 || height <= 0 || longest <= 1) return null;
  if (fitZoom(layoutFor(longest), width, height) >= LEGIBLE_ZOOM) return null;
  let best: number | null = null;
  let zoom = 0;
  for (let n = longest - 1; n >= 1; n--) {
    const z = fitZoom(layoutFor(n), width, height, WRAP_PAD);
    if (z >= MIN_START_ZOOM) return n;
    if (z > zoom + 1e-9) {
      best = n;
      zoom = z;
    }
  }
  if (zoom >= LEGIBLE_ZOOM) return best;
  // Too tall to show whole at a legible zoom: rows as wide as the canvas
  // takes at `MIN_START_ZOOM`; the viewer pans down for the rest.
  const freeW = (width - 2 * WRAP_PAD) / MIN_START_ZOOM;
  for (let n = longest - 1; n >= 1; n--) {
    const b = boundsOf(layoutFor(n));
    if (b && b.w <= freeW) return n;
  }
  return null;
}

/**
 * The first view of a level: the whole level when it is legible, else the
 * card `focus` at zoom 1 in the middle of the free area below "Voltar"
 * (VID-27), else `startViewport`.
 */
export function levelViewport(
  positions: ReadonlyMap<NodeId, Position>,
  width: number,
  height: number,
  focus?: Position,
  padX = FIT_PAD,
): Viewport {
  const fit = fitViewport(positions, width, height, focus, padX);
  if (fit) return fit;
  if (focus) {
    return {
      x: (width - NODE_WIDTH) / 2 - focus.x,
      y: TOP_PAD + (height - TOP_PAD - FIT_PAD - NODE_HEIGHT) / 2 - focus.y,
      zoom: 1,
    };
  }
  return startViewport(positions, width, height);
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
  // FIT_PAD, not SIDE_PAD: a card at the edge of a fitted level is in view.
  const inX = left >= FIT_PAD && left + w <= width - FIT_PAD;
  const inY = top >= 0 && top + h <= height;
  if (inX && inY) return null;
  return {
    x: inX ? v.x : (width - w) / 2 - p.x * v.zoom,
    y: inY ? v.y : (height - h) / 2 - p.y * v.zoom,
    zoom: v.zoom,
  };
}
