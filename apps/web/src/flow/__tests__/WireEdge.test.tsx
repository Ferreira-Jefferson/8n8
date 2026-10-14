import { cleanup, render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { branchLabelAt, type WireData, WireEdge } from "../WireEdge";

// The label portal needs a mounted React Flow; here it renders in place.
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => (
    <div data-testid="labels">{children}</div>
  ),
}));

afterEach(cleanup);

function renderWire(data: WireData, label?: string) {
  return render(
    <ReactFlowProvider>
      <svg>
        <title>fio</title>
        <WireEdge
          sourceX={0}
          sourceY={0}
          targetX={400}
          targetY={200}
          data={data}
          {...(label === undefined ? {} : { label })}
        />
      </svg>
    </ReactFlowProvider>,
  );
}

const timed: WireData = { drawAt: 400, pulseAt: 2100, reduced: false };

describe("WireEdge (VID-05, VID-06)", () => {
  it("draws the curve M x1 y1 C x1+60 y1, x2-60 y2, x2 y2 with class wire and pathLength 1", () => {
    const { container } = renderWire(timed);
    const path = container.querySelector("path.wire");
    expect(path?.getAttribute("d")).toBe("M 0 0 C 60 0, 340 200, 400 200");
    expect(path?.getAttribute("class")).toBe("wire");
    expect(path?.getAttribute("pathLength")).toBe("1");
  });

  it("starts drawing at data-draw-at", () => {
    const { container } = renderWire(timed);
    const path = container.querySelector<SVGPathElement>("path.wire");
    expect(path?.getAttribute("data-draw-at")).toBe("400");
    expect(path?.style.animationDelay).toBe("400ms");
  });

  it("runs one pulse of r 9 along the same curve at data-pulse-at, for 750 ms", () => {
    const { container } = renderWire(timed);
    const pulses = container.querySelectorAll("circle.pulse");
    expect(pulses).toHaveLength(1);
    const pulse = pulses[0];
    expect(pulse?.getAttribute("r")).toBe("9");
    expect(pulse?.getAttribute("data-pulse-at")).toBe("2100");
    const motion = pulse?.querySelector("animateMotion");
    expect(motion?.getAttribute("begin")).toBe("2100ms");
    expect(motion?.getAttribute("dur")).toBe("750ms");
    expect(motion?.getAttribute("path")).toBe("M 0 0 C 60 0, 340 200, 400 200");
  });

  it("renders no pulse with reduced motion (VID-07)", () => {
    const { container } = renderWire({ drawAt: 0, pulseAt: 0, reduced: true });
    expect(container.querySelector("circle.pulse")).toBeNull();
    expect(container.querySelector("path.wire")).not.toBeNull();
  });
});

describe("WireEdge branch labels (VID-21)", () => {
  it.each(["sim", "não"])(
    "shows %s as .branch-label beside the target card",
    (text) => {
      const { container } = renderWire(timed, text);
      const label = container.querySelector<HTMLElement>(".branch-label");
      expect(label?.textContent).toBe(text);
      expect(label?.getAttribute("data-branch-label")).toBe(text);
      // The wire goes down to (400, 200): the label sits under the target
      // card, 70 + 8 px below the port, at the card's left edge.
      expect(label?.style.transform).toBe("translate(400px, 278px)");
    },
  );

  it("puts the label of a wire that goes up above the target card", () => {
    expect(branchLabelAt(200, 400, 0)).toEqual({ x: 400, y: -78, above: true });
  });

  it("puts the label of a wire that goes down or straight below the target card", () => {
    expect(branchLabelAt(0, 400, 200)).toEqual({
      x: 400,
      y: 278,
      above: false,
    });
    expect(branchLabelAt(100, 400, 100)).toEqual({
      x: 400,
      y: 178,
      above: false,
    });
  });

  it("keeps the label clear of the wire: it starts at the target's left edge, outside the wire's vertical span", () => {
    // Sim goes up from 300 to 100, não goes down from 300 to 500.
    const yes = branchLabelAt(300, 760, 100);
    const no = branchLabelAt(300, 760, 500);
    expect(yes.y).toBeLessThan(100 - 70);
    expect(no.y).toBeGreaterThan(500 + 70);
    expect(yes.x).toBe(760);
    expect(no.x).toBe(760);
  });

  it("shows no label on a wire without one", () => {
    const { container } = renderWire(timed);
    expect(container.querySelector(".branch-label")).toBeNull();
  });
});
