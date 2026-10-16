import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Side } from "../sides";
import {
  branchLabelAt,
  curvePath,
  loopPath,
  TAG_DELAY_MS,
  turnPath,
  type WireData,
  WireEdge,
  type WireInfo,
} from "../WireEdge";

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
        <title>aresta</title>
        <WireEdge
          sourceX={0}
          sourceY={0}
          targetX={400}
          targetY={200}
          sourcePosition={Side.Right}
          targetPosition={Side.Left}
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

  it("runs one pulse of r 9 along the same curve at data-pulse-at, for 1500 ms", () => {
    const { container } = renderWire(timed);
    const pulses = container.querySelectorAll("circle.pulse");
    expect(pulses).toHaveLength(1);
    const pulse = pulses[0];
    expect(pulse?.getAttribute("r")).toBe("9");
    expect(pulse?.getAttribute("data-pulse-at")).toBe("2100");
    const motion = pulse?.querySelector("animateMotion");
    expect(motion?.getAttribute("begin")).toBe("2100ms");
    expect(motion?.getAttribute("dur")).toBe("1500ms");
    expect(motion?.getAttribute("path")).toBe("M 0 0 C 60 0, 340 200, 400 200");
  });

  it("renders no pulse with reduced motion (VID-07)", () => {
    const { container } = renderWire({ drawAt: 0, pulseAt: 0, reduced: true });
    expect(container.querySelector("circle.pulse")).toBeNull();
    expect(container.querySelector("path.wire")).not.toBeNull();
  });
});

describe("WireEdge branch labels (VID-21)", () => {
  it.each(["true", "false"])(
    "shows %s as .branch-label by the port of the card the branch leads to",
    (text) => {
      const { container } = renderWire(timed, text);
      const label = container.querySelector<HTMLElement>(".branch-label");
      expect(label?.textContent).toBe(text);
      expect(label?.getAttribute("data-branch-label")).toBe(text);
      // The wire comes down into the left port at (400, 200): the label ends
      // 8 px before the port, 4 px below its line.
      expect(label?.style.transform).toBe(
        "translate(392px, 204px) translateX(-100%)",
      );
    },
  );

  it("puts the label above the end of a wire that comes up into the port", () => {
    expect(branchLabelAt(400, 100, 300, Side.Left)).toEqual({
      x: 392,
      y: 96,
      above: true,
      leftward: true,
    });
  });

  it("puts the label above the end of a straight wire, and below the end of one that comes down", () => {
    expect(branchLabelAt(400, 100, 100, Side.Left)).toEqual({
      x: 392,
      y: 96,
      above: true,
      leftward: true,
    });
    expect(branchLabelAt(400, 300, 100, Side.Left)).toEqual({
      x: 392,
      y: 304,
      above: false,
      leftward: true,
    });
  });

  it("gives the two labels of a condition two places, each by its own card", () => {
    // true comes up from 300 into a card at 100, false down into one at 500.
    const yes = branchLabelAt(1100, 100, 300, Side.Left);
    const no = branchLabelAt(1100, 500, 300, Side.Left);
    expect(yes).toEqual({ x: 1092, y: 96, above: true, leftward: true });
    expect(no).toEqual({ x: 1092, y: 504, above: false, leftward: true });
  });

  it("shows no label on a wire without one", () => {
    const { container } = renderWire(timed);
    expect(container.querySelector(".branch-label")).toBeNull();
  });
});

describe("WireEdge on the sides of the cards", () => {
  it("leaves and arrives straight out of the sides the wire uses", () => {
    expect(curvePath(0, 0, Side.Right, 400, 0, Side.Left)).toBe(
      "M 0 0 C 60 0, 340 0, 400 0",
    );
    expect(curvePath(0, 0, Side.Bottom, 100, 300, Side.Top)).toBe(
      "M 0 0 C 0 60, 100 240, 100 300",
    );
    expect(curvePath(400, 0, Side.Left, 0, 100, Side.Right)).toBe(
      "M 400 0 C 340 0, 60 100, 0 100",
    );
  });

  it("puts a label on a wire that comes into a right port to the right of the port", () => {
    expect(branchLabelAt(100, 200, 100, Side.Right)).toEqual({
      x: 108,
      y: 204,
      above: false,
      leftward: false,
    });
  });

  it("puts a label on a wire into the top of a card above the port, and into the bottom below it", () => {
    expect(branchLabelAt(100, 200, 0, Side.Top)).toEqual({
      x: 104,
      y: 196,
      above: true,
      leftward: false,
    });
    expect(branchLabelAt(100, 200, 400, Side.Bottom)).toEqual({
      x: 104,
      y: 204,
      above: false,
      leftward: false,
    });
  });
});

describe("WireEdge turning to the next row (VID-10)", () => {
  it("goes out right, down into the row gap, back left and down into the port", () => {
    // From the end of a row (port at 1500, 70) to the start of the next one
    // (port at 0, 380), turning in the gap at y = 180.
    expect(turnPath(1500, 70, 0, 380, 180)).toBe(
      "M 1500 70 H 1504 Q 1524 70, 1524 90 V 160 Q 1524 180, 1504 180 H -4 Q -24 180, -24 200 V 360 Q -24 380, -4 380 H 0",
    );
  });

  it("runs right in the gap when the target sits further right", () => {
    expect(turnPath(300, 70, 760, 380, 180)).toBe(
      "M 300 70 H 304 Q 324 70, 324 90 V 160 Q 324 180, 344 180 H 716 Q 736 180, 736 200 V 360 Q 736 380, 756 380 H 760",
    );
  });

  it("draws the turn path, and the pulse follows it, when data.turnY is set", () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg>
          <title>aresta</title>
          <WireEdge
            sourceX={1500}
            sourceY={70}
            targetX={0}
            targetY={380}
            sourcePosition={Side.Right}
            targetPosition={Side.Left}
            data={{ ...timed, turnY: 180 }}
          />
        </svg>
      </ReactFlowProvider>,
    );
    const d = turnPath(1500, 70, 0, 380, 180);
    expect(container.querySelector("path.wire")?.getAttribute("d")).toBe(d);
    expect(container.querySelector("animateMotion")?.getAttribute("path")).toBe(
      d,
    );
  });
});

describe("WireEdge, a dependency wire", () => {
  const dep: WireData = { ...timed, dep: true };

  it("has no pathLength and no pulse, so its dashes keep their size", () => {
    const { container } = renderWire(dep);
    expect(
      container.querySelector("path.wire")?.hasAttribute("pathLength"),
    ).toBe(false);
    expect(container.querySelector("circle.pulse")).toBeNull();
  });

  it("arches over its own card when it leaves and returns to it", () => {
    const { container } = renderWire({ ...dep, loop: true });
    expect(container.querySelector("path.wire")?.getAttribute("d")).toBe(
      loopPath(0, 0, 400, 200),
    );
  });

  const info: WireInfo = {
    kind: "calls",
    reach: "language",
    from: "cliente.py",
    to: "servidor.ts",
  };

  it("shows no tag until the pointer has rested on the wire, then shows kind, reach, channel and ends", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderWire({ ...dep, info }, "HTTP POST /frete");
      const hit = container.querySelector("path.wire-hit") as Element;
      expect(container.querySelector(".wire-tag")).toBeNull();

      fireEvent.mouseEnter(hit, { clientX: 10, clientY: 10 });
      act(() => {
        vi.advanceTimersByTime(TAG_DELAY_MS - 1);
      });
      expect(container.querySelector(".wire-tag")).toBeNull();
      expect(container.querySelector("path.wire")?.getAttribute("class")).toBe(
        "wire wire-hover",
      );

      act(() => {
        vi.advanceTimersByTime(1);
      });
      const tag = container.querySelector(".wire-tag");
      expect(tag?.getAttribute("class")).toBe("wire-tag wire-tag-ext");
      expect(tag?.querySelector(".wire-tag-kind")?.textContent).toBe(
        "Chama · entre linguagens",
      );
      expect(container.querySelector(".dep-label")?.textContent).toBe(
        "HTTP POST /frete",
      );
      expect(tag?.textContent).toContain("cliente.py");
      expect(tag?.textContent).toContain("servidor.ts");

      fireEvent.mouseLeave(hit);
      expect(container.querySelector(".wire-tag")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows nothing when the pointer only passes over the wire", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderWire({ ...dep, info });
      const hit = container.querySelector("path.wire-hit") as Element;
      fireEvent.mouseEnter(hit);
      act(() => {
        vi.advanceTimersByTime(TAG_DELAY_MS - 20);
      });
      fireEvent.mouseLeave(hit);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(container.querySelector(".wire-tag")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves out the channel line when the wire has no label, and uses no copper inside a project", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderWire({
        ...dep,
        info: { ...info, kind: "extends", reach: "across" },
      });
      fireEvent.mouseEnter(container.querySelector("path.wire-hit") as Element);
      act(() => {
        vi.advanceTimersByTime(TAG_DELAY_MS);
      });
      expect(container.querySelector(".dep-label")).toBeNull();
      expect(container.querySelector(".wire-tag")?.getAttribute("class")).toBe(
        "wire-tag",
      );
      expect(container.querySelector(".wire-tag-kind")?.textContent).toBe(
        "Herda · entre arquivos",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("has no hover strip when it is not a dependency wire, and keeps its label visible", () => {
    const { container } = renderWire(timed, "true");
    expect(container.querySelector("path.wire-hit")).toBeNull();
    expect(container.querySelector("[data-branch-label]")).not.toBeNull();
  });

  it("loopPath rises above both ports, out of the first and into the second", () => {
    expect(loopPath(320, 70, 0, 70)).toBe("M 320 70 C 380 -80, -60 -80, 0 70");
  });
});
