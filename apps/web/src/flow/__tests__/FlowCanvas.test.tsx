import type { Explanation, FlowEdge, FlowNode, NodeId } from "@code2n8n/model";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { codeLineOf } from "../card";
import { FlowCanvas, type FlowCanvasProps, toFlowEdges } from "../FlowCanvas";
import type { Schedule } from "../motion";
import { videoGraph } from "./video-graph";

const P = "fn:processar_pedido";
const C = "fn:calcular_frete";

describe("toFlowEdges (VID-05, PROJ-03)", () => {
  it("draws every wire as a wire edge with its times and marks only imports with edge-imports", () => {
    const edges: FlowEdge[] = [
      { id: "i", kind: "imports", source: "dir:pedidos", target: "dir:frete" },
      { id: "c", kind: "calls", source: "fn:a", target: "fn:b" },
      { id: "n", kind: "next", source: "fn:a/s0", target: "fn:a/s1" },
      {
        id: "b",
        kind: "branch",
        source: "fn:a/s1",
        target: "fn:a/s2",
        label: "sim",
      },
    ];
    const times: Schedule = {
      enterAt: new Map(),
      drawAt: new Map([
        ["i", 400],
        ["c", 750],
        ["n", 1100],
        ["b", 1450],
      ]),
      pulseAt: new Map([
        ["i", 2750],
        ["c", 3500],
        ["n", 4250],
        ["b", 5000],
      ]),
    };
    const data = (drawAt: number, pulseAt: number) => ({
      drawAt,
      pulseAt,
      reduced: false,
    });
    expect(toFlowEdges(edges, times, false)).toEqual([
      {
        id: "i",
        source: "dir:pedidos",
        target: "dir:frete",
        type: "wire",
        data: data(400, 2750),
        className: "edge-imports",
      },
      {
        id: "c",
        source: "fn:a",
        target: "fn:b",
        type: "wire",
        data: data(750, 3500),
      },
      {
        id: "n",
        source: "fn:a/s0",
        target: "fn:a/s1",
        type: "wire",
        data: data(1100, 4250),
      },
      {
        id: "b",
        source: "fn:a/s1",
        target: "fn:a/s2",
        type: "wire",
        data: data(1450, 5000),
        label: "sim",
      },
    ]);
  });

  it("passes reduced to every wire (VID-07)", () => {
    const edges: FlowEdge[] = [
      { id: "n", kind: "next", source: "a", target: "b" },
    ];
    const times: Schedule = {
      enterAt: new Map(),
      drawAt: new Map(),
      pulseAt: new Map(),
    };
    expect(toFlowEdges(edges, times, true)[0]?.data?.reduced).toBe(true);
  });
});

// React Flow in jsdom: the testing setup from the React Flow docs.
beforeAll(() => {
  class ResizeObserver {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
      // Like the browser, the first size arrives after the effects ran.
      setTimeout(() =>
        this.cb(
          [
            {
              target,
              contentRect: { width: 1000, height: 800 },
            } as ResizeObserverEntry,
          ],
          this as unknown as globalThis.ResizeObserver,
        ),
      );
    }
    unobserve() {}
    disconnect() {}
  }
  class DOMMatrixReadOnly {
    m22 = 1;
  }
  vi.stubGlobal("ResizeObserver", ResizeObserver);
  vi.stubGlobal("DOMMatrixReadOnly", DOMMatrixReadOnly);
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: {
      configurable: true,
      get() {
        return Number.parseFloat(this.style.height) || 140;
      },
    },
    offsetWidth: {
      configurable: true,
      get() {
        return Number.parseFloat(this.style.width) || 320;
      },
    },
  });
});

let reduced = false;
beforeEach(() => {
  reduced = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" && reduced,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function props(overrides: Partial<FlowCanvasProps> = {}): FlowCanvasProps {
  return {
    graph: videoGraph,
    levelId: null,
    depth: 0,
    selected: null,
    titles: new Map(),
    codeLineOf: (n) => codeLineOf(n, ""),
    explanations: new Map(),
    suggestionCounts: new Map(),
    focusId: null,
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    onSuggestion: vi.fn(),
    ...overrides,
  };
}

function canvasEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(".canvas");
  if (!el) throw new Error("no .canvas");
  return el;
}

function nodeEl(container: HTMLElement, id: NodeId): HTMLElement {
  const el = [
    ...container.querySelectorAll<HTMLElement>(".react-flow__node"),
  ].find((n) => n.getAttribute("data-id") === id);
  if (!el) throw new Error(`no node ${id}`);
  return el;
}

function card(container: HTMLElement, id: NodeId): HTMLElement {
  const el = nodeEl(container, id).querySelector<HTMLElement>(".node");
  if (!el) throw new Error(`no card ${id}`);
  return el;
}

// The first React Flow render in a file pays a one-off cold cost in jsdom
// (seconds when every package runs its tests at once). Paying it here keeps
// it out of whichever test comes first, like src/__tests__/setup.tsx.
beforeAll(() => {
  render(<FlowCanvas {...props()} />);
  cleanup();
}, 30_000);

const node = (id: NodeId) =>
  videoGraph.nodes.find((n) => n.id === id) as FlowNode;

describe("FlowCanvas, one click (VID-18, VID-23, VID-25)", () => {
  it("expands a node that opens and calls onOpen only after the 1100 ms transition", () => {
    vi.useFakeTimers();
    const p = props();
    const { container } = render(<FlowCanvas {...p} />);
    fireEvent.click(nodeEl(container, P));
    expect(canvasEl(container).getAttribute("data-phase")).toBe("expanding");
    expect(container.querySelector(".open-frame")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1099));
    expect(p.onOpen).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(p.onOpen).toHaveBeenCalledTimes(1);
    expect(p.onOpen).toHaveBeenCalledWith(node(P));
    expect(canvasEl(container).getAttribute("data-phase")).toBe("open");
    expect(container.querySelector(".open-frame")).toBeNull();
    expect(p.onSelect).not.toHaveBeenCalled();
  });

  it("opens at once with reduced motion (VID-07)", () => {
    reduced = true;
    const p = props();
    const { container } = render(<FlowCanvas {...p} />);
    fireEvent.click(nodeEl(container, P));
    expect(p.onOpen).toHaveBeenCalledWith(node(P));
    expect(canvasEl(container).getAttribute("data-phase")).toBe("open");
    expect(container.querySelector(".open-frame")).toBeNull();
  });

  it("selects a leaf without changing the phase", () => {
    const p = props();
    const { container } = render(<FlowCanvas {...p} />);
    fireEvent.click(nodeEl(container, `${P}/s5`));
    expect(p.onSelect).toHaveBeenCalledWith(`${P}/s5`);
    expect(p.onOpen).not.toHaveBeenCalled();
    expect(canvasEl(container).getAttribute("data-phase")).toBe("open");
  });

  it("does nothing on a double click", () => {
    const p = props();
    const { container } = render(<FlowCanvas {...p} />);
    fireEvent.doubleClick(nodeEl(container, P));
    expect(p.onOpen).not.toHaveBeenCalled();
    expect(p.onSelect).not.toHaveBeenCalled();
  });
});

describe("FlowCanvas, level and cards (VID-06, VID-22, VID-27)", () => {
  it("marks the top level and gives an inner level the frame", () => {
    const top = render(<FlowCanvas {...props()} />);
    expect(canvasEl(top.container).getAttribute("data-level")).toBe("top");
    expect(canvasEl(top.container).classList.contains("level-frame")).toBe(
      false,
    );
    cleanup();
    const inner = render(<FlowCanvas {...props({ levelId: C, depth: 1 })} />);
    expect(canvasEl(inner.container).getAttribute("data-level")).toBe("inner");
    expect(canvasEl(inner.container).classList.contains("level-frame")).toBe(
      true,
    );
  });

  it("starts the 8-card main flow at zoom 0.8 with the first card at the left (VID-03, VID-10)", async () => {
    const { container } = render(<FlowCanvas {...props()} />);
    const viewport = () =>
      container.querySelector<HTMLElement>(".react-flow__viewport")?.style
        .transform;
    // React Flow reads the canvas size from the offsetWidth / offsetHeight
    // stubs: the pane's "100%" parses to 100 x 100. That is too small for the
    // level, so it starts at its top-left card, 40 px from the left and 140 px
    // from the top (the odd cards sit 90 px higher: 140 + 90 * 0.8 = 212).
    await waitFor(() =>
      expect(viewport()).toBe("translate(40px,212px) scale(0.8)"),
    );
  });

  it("brings a selected card that sits outside the canvas back into view (VID-22, VID-25)", async () => {
    const { container, rerender } = render(<FlowCanvas {...props()} />);
    const viewport = () =>
      container.querySelector<HTMLElement>(".react-flow__viewport")?.style
        .transform;
    await waitFor(() =>
      expect(viewport()).toBe("translate(40px,212px) scale(0.8)"),
    );
    // s2 (the 4th card) sits at x = 1140 and y = -90, far past the 100 px
    // stub canvas: it is centered, (100 - 256) / 2 - 1140 * 0.8 = -990 and
    // (100 - 112) / 2 + 90 * 0.8 = 66.
    rerender(<FlowCanvas {...props({ selected: `${P}/s2` })} />);
    await waitFor(() =>
      expect(viewport()).toBe("translate(-990px,66px) scale(0.8)"),
    );
  });

  it("gives the main flow cards data-enter-at from left to right", () => {
    const { container } = render(<FlowCanvas {...props()} />);
    const ids = [P, ...[0, 1, 2, 3, 4, 5, 6].map((i) => `${P}/s${i}`)];
    expect(
      ids.map((id) => card(container, id).getAttribute("data-enter-at")),
    ).toEqual(["0", "350", "700", "1050", "1400", "1750", "2100", "2450"]);
  });

  it("tags the entry GATILHO and shows the titles it gets (VID-04, VID-14)", () => {
    const { container } = render(
      <FlowCanvas
        {...props({ titles: new Map([[`${P}/s5`, "Grava o pedido"]]) })}
      />,
    );
    expect(card(container, P).getAttribute("data-tag")).toBe("GATILHO");
    expect(card(container, `${P}/s5`).querySelector(".name")?.textContent).toBe(
      "Grava o pedido",
    );
    expect(card(container, `${P}/s4`).querySelector(".name")?.textContent).toBe(
      "Soma itens",
    );
  });

  it("hides the input port of the entry and the output port of the last step (VID-03)", () => {
    const { container } = render(<FlowCanvas {...props()} />);
    const port = (id: NodeId, side: string) =>
      card(container, id).querySelector<HTMLElement>(`.port-${side}`)?.style
        .visibility;
    expect(port(P, "in")).toBe("hidden");
    expect(port(P, "out")).toBe("visible");
    expect(port(`${P}/s6`, "in")).toBe("visible");
    expect(port(`${P}/s6`, "out")).toBe("hidden");
  });

  it("borders the selected node with on (VID-22)", () => {
    const { container } = render(
      <FlowCanvas {...props({ selected: `${P}/s2` })} />,
    );
    expect(card(container, `${P}/s2`).classList.contains("on")).toBe(true);
    expect(card(container, `${P}/s1`).classList.contains("on")).toBe(false);
  });

  it("draws the wires of the level with the wire edge (VID-05)", async () => {
    const { container } = render(<FlowCanvas {...props({ levelId: C })} />);
    await waitFor(() =>
      expect(container.querySelectorAll("path.wire")).toHaveLength(4),
    );
    expect(
      [...container.querySelectorAll(".branch-label")].map(
        (l) => l.textContent,
      ),
    ).toEqual(["sim", "não"]);
  });
});

describe("FlowCanvas suggestion cards (VID-31, VID-32, VID-33)", () => {
  const suggestion = (id: string, line: number, command: string) => ({
    id,
    command,
    reason: "motivo",
    line,
    severity: "media" as const,
    lines: [line],
  });
  const explanation: Explanation = {
    summary: "",
    sentences: [],
    inputs: [],
    outputs: [],
    suggestions: [
      suggestion("g1", 12, "Grave o pedido numa transação"),
      suggestion("g2", 13, "Envie o e-mail fora da requisição"),
    ],
  };

  it("anchors the cards on BANCO and E-MAIL of the main flow, which get on while the rest dims", () => {
    const { container } = render(
      <FlowCanvas {...props({ explanations: new Map([[P, explanation]]) })} />,
    );
    const cards = [...container.querySelectorAll<HTMLElement>(".alert")];
    expect(
      cards.map((c) => [c.textContent, c.getAttribute("data-anchor-id")]),
    ).toEqual([
      ["Grave o pedido numa transação", `${P}/s5`],
      ["Envie o e-mail fora da requisição", `${P}/s6`],
    ]);
    for (const id of [`${P}/s5`, `${P}/s6`]) {
      expect(card(container, id).classList.contains("on")).toBe(true);
      expect(card(container, id).classList.contains("dim")).toBe(false);
    }
    for (const id of [P, `${P}/s0`, `${P}/s4`]) {
      expect(card(container, id).classList.contains("dim")).toBe(true);
      expect(card(container, id).classList.contains("on")).toBe(false);
    }
  });

  it("places a card 20 px right of and 64 px above its anchor", () => {
    const { container } = render(
      <FlowCanvas {...props({ explanations: new Map([[P, explanation]]) })} />,
    );
    const first = container.querySelector<HTMLElement>(".alert");
    // s5 sits at x = 6 * 380 on the main flow row.
    expect(first?.style.transform).toBe("translate(2300px, -64px)");
  });

  it("sticks a card without a visible line to the frame of the open node", () => {
    const outside: Explanation = {
      ...explanation,
      suggestions: [suggestion("g9", 17, "Documente a função")],
    };
    const { container } = render(
      <FlowCanvas
        {...props({
          levelId: C,
          depth: 1,
          explanations: new Map([[C, outside]]),
        })}
      />,
    );
    const framed = container.querySelector(".frame-cards .alert");
    expect(framed?.textContent).toBe("Documente a função");
    expect(framed?.getAttribute("data-anchor-id")).toBe("frame");
  });

  it("calls onSuggestion with the explained node and the line", () => {
    const p = props({ explanations: new Map([[P, explanation]]) });
    render(<FlowCanvas {...p} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Envie o e-mail fora da requisição" }),
    );
    expect(p.onSuggestion).toHaveBeenCalledWith(P, 13);
  });
});
