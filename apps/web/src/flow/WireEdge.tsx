import { type Edge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";

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
}

export type WireFlowEdge = Edge<WireData, "wire">;

const BEND = 60;
const PULSE_MS = 750;
/** A branch label starts this far right of the source port, past the wire's first bend. */
const LABEL_X = 30;
/** Space between a branch label and the line of the source port. */
const LABEL_GAP = 4;

/**
 * Where a branch label sits: next to the start of its wire, in the gap
 * between the target cards, so it touches no wire and no card (VID-21). A
 * wire that goes up gets its label above the port line; a wire that goes
 * down or straight, below.
 */
export function branchLabelAt(
  sourceX: number,
  sourceY: number,
  targetY: number,
): { x: number; y: number; above: boolean } {
  const above = targetY < sourceY;
  return {
    x: sourceX + LABEL_X,
    y: above ? sourceY - LABEL_GAP : sourceY + LABEL_GAP,
    above,
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

/** A lime curve that draws itself, carries one pulse and a "sim"/"não" label (VID-05, 06, 07, 21). */
export function WireEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  label,
}: Pick<
  EdgeProps<WireFlowEdge>,
  "sourceX" | "sourceY" | "targetX" | "targetY" | "data" | "label"
>) {
  const w = [
    sourceX,
    sourceY,
    sourceX + BEND,
    sourceY,
    targetX - BEND,
    targetY,
    targetX,
    targetY,
  ];
  const d =
    data?.turnY !== undefined
      ? turnPath(sourceX, sourceY, targetX, targetY, data.turnY)
      : data?.lane !== undefined && sourceY !== targetY
        ? lanePath(sourceX, sourceY, targetX, targetY, data.lane)
        : `M ${w[0]} ${w[1]} C ${w[2]} ${w[3]}, ${w[4]} ${w[5]}, ${w[6]} ${w[7]}`;
  const drawAt = data?.drawAt ?? 0;
  const pulseAt = data?.pulseAt ?? 0;
  const spot = branchLabelAt(sourceX, sourceY, targetY);
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
              transform: `translate(${spot.x}px, ${spot.y}px)${spot.above ? " translateY(-100%)" : ""}`,
            }}
          >
            {label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
