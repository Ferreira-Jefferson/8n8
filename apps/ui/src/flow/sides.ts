import { Position as Side } from "@xyflow/react";
import type { Position } from "./layout";

export { Side };

export const SIDES = [Side.Left, Side.Right, Side.Top, Side.Bottom] as const;

/** A wire of the automatic layout leaves by the right side and arrives by the left one. */
export const FLOW_SIDES: readonly [Side, Side] = [Side.Right, Side.Left];

/** How much wider than tall the gap between two cards must be for a wire to use their left and right sides. */
const HORIZONTAL = 1.4;

/**
 * The sides a wire uses between two cards of the same size: the ones that
 * face each other. A target far to the side gets right and left; one above
 * or below gets bottom and top.
 */
export function pickSides(source: Position, target: Position): [Side, Side] {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy) * HORIZONTAL) {
    return dx >= 0 ? [Side.Right, Side.Left] : [Side.Left, Side.Right];
  }
  return dy >= 0 ? [Side.Bottom, Side.Top] : [Side.Top, Side.Bottom];
}

/**
 * The sides of the wire that runs back between two cards a wire already joins:
 * below both cards when they stand side by side, on their left when they stand
 * one above the other. It never crosses a card.
 */
export function backSides(source: Position, target: Position): [Side, Side] {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? [Side.Bottom, Side.Bottom]
    : [Side.Left, Side.Left];
}
