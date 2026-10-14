import { type Edge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import { NODE_HEIGHT } from "./layout";

export interface WireData extends Record<string, unknown> {
  /** Milliseconds until the wire draws (VID-06). */
  drawAt: number;
  /** Milliseconds until the pulse runs along the wire (VID-06). */
  pulseAt: number;
  /** Less motion: no pulse (VID-07). */
  reduced: boolean;
}

export type WireFlowEdge = Edge<WireData, "wire">;

const BEND = 60;
const PULSE_MS = 750;
/** Space between a branch label and the edge of its target card. */
const LABEL_GAP = 8;

/**
 * Where a branch label sits: beside the target card, on the side away from the
 * source, so it touches no wire and no card (VID-21). A wire that goes up gets
 * its label above the target card; a wire that goes down or straight, below.
 * SPEC_DEVIATION: design.md put the label at t = 0.25 of the curve, 14 px up.
 * Reason: in the 60 px gap between columns that label sat on the wire.
 */
export function branchLabelAt(
  sourceY: number,
  targetX: number,
  targetY: number,
): { x: number; y: number; above: boolean } {
  const above = targetY < sourceY;
  const half = NODE_HEIGHT / 2 + LABEL_GAP;
  return { x: targetX, y: above ? targetY - half : targetY + half, above };
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
  const d = `M ${w[0]} ${w[1]} C ${w[2]} ${w[3]}, ${w[4]} ${w[5]}, ${w[6]} ${w[7]}`;
  const drawAt = data?.drawAt ?? 0;
  const pulseAt = data?.pulseAt ?? 0;
  const spot = branchLabelAt(sourceY, targetX, targetY);
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
