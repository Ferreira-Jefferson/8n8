import { type Edge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";

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
const LABEL_T = 0.25;
const LABEL_LIFT = 14;

/** A point of the cubic curve at `t`. */
function at(w: number[], t: number): [number, number] {
  const q = 1 - t;
  const a = q * q * q;
  const b = 3 * q * q * t;
  const c = 3 * q * t * t;
  const d = t * t * t;
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0, x2 = 0, y2 = 0, x3 = 0, y3 = 0] = w;
  return [a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3];
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
  const [lx, ly] = at(w, LABEL_T);
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
              transform: `translate(-50%, -50%) translate(${lx}px, ${ly - LABEL_LIFT}px)`,
            }}
          >
            {label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
