import type { EdgeLabelKey } from "@8n8/model";
import { type Edge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import { type MessageKey, useT } from "../i18n";
import { Side } from "./sides";

export interface WireData extends Record<string, unknown> {
  /** Milliseconds until the wire draws (VID-06). */
  drawAt: number;
  /** Milliseconds until the pulse runs along the wire (VID-06). */
  pulseAt: number;
  /** Less motion: no pulse (VID-07). */
  reduced: boolean;
  /** The wire goes to a later band of a wrapped level and turns at this y (VID-10, 23). */
  turnY?: number | undefined;
  /** The wire shares its gap with others and runs down or up at this x. */
  lane?: number | undefined;
  /** The system wrote the label: the wire says the key's words in the language of the system. */
  labelKey?: EdgeLabelKey | undefined;
}

export type WireFlowEdge = Edge<WireData, "wire">;

const BEND = 60;
const PULSE_MS = 1500;
/** A branch label ends this far before the target port. */
const LABEL_INSET = 8;
/** Space between a branch label and the line of the target port. */
const LABEL_GAP = 4;

/**
 * Where a branch label sits: next to the end of its wire, by the port of the
 * card the branch leads to, so each label reads with its own card (VID-21).
 * The label goes on the side of the wire's end that the wire does not come
 * from: below the end of a wire that comes down into the port, above the end
 * of one that comes up or straight. So it never crosses its own wire. Into the
 * top or the bottom of a card, the label sits to the right of the port.
 */
export function branchLabelAt(
  targetX: number,
  targetY: number,
  sourceY: number,
  side: Side,
): { x: number; y: number; above: boolean; leftward: boolean } {
  if (side === Side.Top || side === Side.Bottom) {
    const above = side === Side.Top;
    return {
      x: targetX + LABEL_GAP,
      y: above ? targetY - LABEL_GAP : targetY + LABEL_GAP,
      above,
      leftward: false,
    };
  }
  const above = sourceY >= targetY;
  const leftward = side === Side.Left;
  return {
    x: leftward ? targetX - LABEL_INSET : targetX + LABEL_INSET,
    y: above ? targetY - LABEL_GAP : targetY + LABEL_GAP,
    above,
    leftward,
  };
}

/** How far a turning wire runs out of a port before it bends. */
const TURN_OUT = 24;
const TURN_R = 20;

/**
 * The path of a wire into a later band of a wrapped level: out to the right,
 * down to `mid` in the gap between the bands, across to just before the
 * target, and down into its port (VID-10, 23).
 */
export function turnPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  mid: number,
) {
  const r = TURN_R;
  const right = x1 + TURN_OUT;
  const left = x2 - TURN_OUT;
  const dir = left < right ? -1 : 1;
  return [
    `M ${x1} ${y1}`,
    `H ${right - r}`,
    `Q ${right} ${y1}, ${right} ${y1 + r}`,
    `V ${mid - r}`,
    `Q ${right} ${mid}, ${right + dir * r} ${mid}`,
    `H ${left - dir * r}`,
    `Q ${left} ${mid}, ${left} ${mid + r}`,
    `V ${y2 - r}`,
    `Q ${left} ${y2}, ${left + r} ${y2}`,
    `H ${x2}`,
  ].join(" ");
}

/**
 * The path of a wire on its own lane: out to the right, down or up at
 * `lane`, and on to the target, with round corners.
 */
export function lanePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  lane: number,
) {
  const dir = y2 > y1 ? 1 : -1;
  const r = Math.max(
    0,
    Math.min(TURN_R, Math.abs(y2 - y1) / 2, lane - x1, x2 - lane),
  );
  return [
    `M ${x1} ${y1}`,
    `H ${lane - r}`,
    `Q ${lane} ${y1}, ${lane} ${y1 + dir * r}`,
    `V ${y2 - dir * r}`,
    `Q ${lane} ${y2}, ${lane + r} ${y2}`,
    `H ${x2}`,
  ].join(" ");
}

const OUT: Record<Side, readonly [number, number]> = {
  [Side.Left]: [-1, 0],
  [Side.Right]: [1, 0],
  [Side.Top]: [0, -1],
  [Side.Bottom]: [0, 1],
};

/** The curve from a port to another; each end leaves its side straight out before it bends. */
export function curvePath(
  x1: number,
  y1: number,
  from: Side,
  x2: number,
  y2: number,
  to: Side,
) {
  const [ax, ay] = OUT[from];
  const [bx, by] = OUT[to];
  return `M ${x1} ${y1} C ${x1 + ax * BEND} ${y1 + ay * BEND}, ${x2 + bx * BEND} ${y2 + by * BEND}, ${x2} ${y2}`;
}

/** A Petróleo curve that draws itself, carries one pulse and a "true"/"false" label (VID-05, 06, 07, 21). */
export function WireEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  label,
}: Pick<
  EdgeProps<WireFlowEdge>,
  | "sourceX"
  | "sourceY"
  | "targetX"
  | "targetY"
  | "sourcePosition"
  | "targetPosition"
  | "data"
  | "label"
>) {
  const t = useT();
  // `data-branch-label` keeps the raw label: styles and tests read it, whatever the language.
  const shown = data?.labelKey
    ? t(`edge.${data.labelKey}` as MessageKey)
    : label;
  const d =
    data?.turnY !== undefined
      ? turnPath(sourceX, sourceY, targetX, targetY, data.turnY)
      : data?.lane !== undefined && sourceY !== targetY
        ? lanePath(sourceX, sourceY, targetX, targetY, data.lane)
        : curvePath(
            sourceX,
            sourceY,
            sourcePosition,
            targetX,
            targetY,
            targetPosition,
          );
  const drawAt = data?.drawAt ?? 0;
  const pulseAt = data?.pulseAt ?? 0;
  const spot = branchLabelAt(targetX, targetY, sourceY, targetPosition);
  return (
    <>
      <path
        className="wire"
        d={d}
        pathLength={1}
        data-draw-at={drawAt}
        style={{ animationDelay: `${drawAt}ms` }}
      />
      {!data?.reduced && (
        <circle
          className="pulse"
          r={9}
          data-pulse-at={pulseAt}
          visibility="hidden"
        >
          <animateMotion
            begin={`${pulseAt}ms`}
            dur={`${PULSE_MS}ms`}
            path={d}
            fill="remove"
          />
          <set
            attributeName="visibility"
            to="visible"
            begin={`${pulseAt}ms`}
            dur={`${PULSE_MS}ms`}
          />
        </circle>
      )}
      {typeof label === "string" && label !== "" && (
        <EdgeLabelRenderer>
          <span
            className="branch-label"
            data-branch-label={label}
            style={{
              transform: `translate(${spot.x}px, ${spot.y}px)${spot.leftward ? " translateX(-100%)" : ""}${spot.above ? " translateY(-100%)" : ""}`,
            }}
          >
            {shown}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
