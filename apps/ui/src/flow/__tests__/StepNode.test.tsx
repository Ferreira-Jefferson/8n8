import type { FlowNode, NodeKind } from "@8n8/model";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StepNode, type StepNodeData } from "../StepNode";
import { Side } from "../sides";

afterEach(cleanup);

function node(overrides: Partial<FlowNode> = {}): FlowNode {
  return {
    id: "fn:calcular_frete",
    kind: "function",
    label: "calcular_frete",
    parentId: null,
    range: { start: 4, end: 11 },
    openable: true,
    ...overrides,
  };
}

const httpStep = node({
  id: "fn:calcular_frete/s0",
  kind: "external",
  label: "requests.get",
  callee: "requests.get",
  category: "HTTP",
  parentId: "fn:calcular_frete",
  openable: false,
});

function renderStep(n: FlowNode, extra: Partial<StepNodeData> = {}) {
  const data: StepNodeData = {
    node: n,
    isTrigger: false,
    codeLine: "",
    openable: n.openable,
    portsIn: new Set([Side.Left]),
    portsOut: new Set([Side.Right]),
    enterAt: 0,
    selected: false,
    ...extra,
  };
  return render(
    <ReactFlowProvider>
      <StepNode data={data} />
    </ReactFlowProvider>,
  );
}

function card(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(".node");
  if (!el) throw new Error("no .node");
  return el;
}

function part(container: HTMLElement, selector: string): string | null {
  return container.querySelector(selector)?.textContent ?? null;
}

describe("StepNode, the three-line card (VID-03, VID-26)", () => {
  it("shows FUNÇÃO, the title with › and the code line", () => {
    const { container } = renderStep(node(), {
      title: "Calcular frete",
      codeLine: "calcular_frete()",
    });
    expect(part(container, ".tag")).toBe("FUNÇÃO");
    expect(part(container, ".name .open-mark")).toBe("›");
    expect(part(container, ".name")).toBe("Calcular frete›");
    expect(container.querySelector(".name")?.getAttribute("title")).toBe(
      "Calcular frete",
    );
    expect(part(container, ".fn")).toBe("calcular_frete()");
    expect(card(container).getAttribute("data-tag")).toBe("FUNÇÃO");
  });

  it("shows the provisional name without a title (VID-15)", () => {
    const { container } = renderStep(node());
    expect(part(container, ".name")).toBe("Calcular frete›");
  });

  it("shows the title, not the provisional name, when the title is given (VID-14)", () => {
    const { container } = renderStep(node(), { title: "Calcula o frete" });
    expect(part(container, ".name")).toBe("Calcula o frete›");
  });

  it("gives a leaf no › mark (VID-26)", () => {
    const { container } = renderStep(httpStep, { codeLine: "requests.get()" });
    expect(part(container, ".name")).toBe("Get");
    expect(container.querySelector(".open-mark")).toBeNull();
  });

  it("tags the entry of the main flow as GATILHO (VID-04)", () => {
    const { container } = renderStep(node(), { isTrigger: true });
    expect(part(container, ".tag")).toBe("GATILHO");
    expect(card(container).getAttribute("data-tag")).toBe("GATILHO");
  });

  it("shows the external category as the tag (CORE-12)", () => {
    const { container } = renderStep(httpStep);
    expect(part(container, ".tag")).toBe("HTTP");
  });

  it("carries data-enter-at and the matching animation delay (VID-06)", () => {
    const { container } = renderStep(node(), { enterAt: 700 });
    expect(card(container).getAttribute("data-enter-at")).toBe("700");
    expect(card(container).style.animationDelay).toBe("700ms");
  });
});

describe("StepNode ports (VID-03)", () => {
  function ports(container: HTMLElement) {
    const handles = [
      ...container.querySelectorAll<HTMLElement>(".react-flow__handle.port"),
    ];
    return (kind: "in" | "out", side: Side) =>
      handles.find(
        (h) =>
          h.classList.contains(`port-${kind}`) &&
          h.classList.contains(`port-${side}`),
      )?.style.visibility;
  }

  it("has an input and an output port on each of the four sides", () => {
    const { container } = renderStep(node());
    expect(container.querySelectorAll(".react-flow__handle.port")).toHaveLength(
      8,
    );
  });

  it("shows only the ports of the sides where a wire arrives or leaves", () => {
    const { container } = renderStep(node());
    const port = ports(container);
    expect(port("in", Side.Left)).toBe("visible");
    expect(port("out", Side.Right)).toBe("visible");
    expect(port("in", Side.Right)).toBe("hidden");
    expect(port("out", Side.Left)).toBe("hidden");
    expect(port("in", Side.Top)).toBe("hidden");
    expect(port("out", Side.Bottom)).toBe("hidden");
  });

  it("hides the input ports with no wire arriving", () => {
    const { container } = renderStep(node(), { portsIn: new Set() });
    const port = ports(container);
    expect(port("in", Side.Left)).toBe("hidden");
    expect(port("out", Side.Right)).toBe("visible");
  });

  it("hides the output ports with no wire leaving", () => {
    const { container } = renderStep(node(), { portsOut: new Set() });
    const port = ports(container);
    expect(port("in", Side.Left)).toBe("visible");
    expect(port("out", Side.Right)).toBe("hidden");
  });

  it("shows the port of the side a wire uses, whichever it is", () => {
    const { container } = renderStep(node(), {
      portsIn: new Set([Side.Top]),
      portsOut: new Set([Side.Bottom]),
    });
    const port = ports(container);
    expect(port("in", Side.Top)).toBe("visible");
    expect(port("out", Side.Bottom)).toBe("visible");
    expect(port("in", Side.Left)).toBe("hidden");
  });
});

describe("StepNode selection (VID-22)", () => {
  it("adds on when selected", () => {
    const { container } = renderStep(node(), { selected: true });
    expect(card(container).classList.contains("on")).toBe(true);
  });

  it("has no on when not selected", () => {
    const { container } = renderStep(node());
    expect(card(container).classList.contains("on")).toBe(false);
  });
});

describe("StepNode badges (CORE-06, CORE-23)", () => {
  it("shows the syntax error line (CORE-06)", () => {
    renderStep(node({ syntaxError: { line: 4 } }));
    expect(screen.getByText("Erro de sintaxe na linha 4")).toBeTruthy();
  });

  it("shows a button badge with the suggestion count (CORE-23)", () => {
    const { container } = renderStep(node(), { suggestionCount: 2 });
    const badge = screen.getByRole("button", { name: "2 sugestões" });
    expect(badge.textContent).toBe("2");
    expect(badge.classList.contains("step-badge")).toBe(true);
    expect(badge.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".step-badge > i.dot")).not.toBeNull();
  });

  it("names one suggestion in the singular", () => {
    renderStep(node(), { suggestionCount: 1 });
    expect(screen.getByRole("button", { name: "1 sugestão" })).toBeTruthy();
  });

  it("hands the badge to onSuggestions on a click, and marks it open", () => {
    const onSuggestions = vi.fn();
    renderStep(node(), {
      suggestionCount: 2,
      suggestionsOpen: true,
      onSuggestions,
    });
    const badge = screen.getByRole("button", { name: "2 sugestões" });
    expect(badge.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(badge);
    expect(onSuggestions).toHaveBeenCalledTimes(1);
    expect(onSuggestions).toHaveBeenCalledWith(badge);
  });

  it("shows no badge when the count is 0", () => {
    const { container } = renderStep(node(), { suggestionCount: 0 });
    expect(container.querySelector(".step-badge")).toBeNull();
  });

  it("shows no badge when the count is absent", () => {
    const { container } = renderStep(node());
    expect(container.querySelector(".step-badge")).toBeNull();
  });
});

const ALL_KINDS: NodeKind[] = [
  "module",
  "function",
  "class",
  "code",
  "call",
  "external",
  "condition",
  "loop",
  "block",
  "folder",
  "file",
  "return",
];

function tagText(kind: NodeKind): string {
  const { container } = renderStep(
    node({ id: `x:${kind}`, kind, label: kind }),
  );
  const text = part(container, ".tag") ?? "";
  cleanup();
  return text;
}

describe("StepNode, folder and file nodes (PROJ-02)", () => {
  it("shows the label of a folder node and of a file node", () => {
    const folder = renderStep(
      node({ id: "dir:frete", kind: "folder", label: "frete", path: "frete" }),
    );
    expect(part(folder.container, ".name")).toBe("frete›");
    cleanup();
    const file = renderStep(
      node({
        id: "file:frete/calculo.py",
        kind: "file",
        label: "calculo.py",
        path: "frete/calculo.py",
      }),
    );
    expect(part(file.container, ".name")).toBe("calculo.py›");
  });

  it.each(["folder", "file"] as const)(
    "gives %s its own non-emoji tag",
    (kind) => {
      const tags = new Map(ALL_KINDS.map((k) => [k, tagText(k)]));
      const own = tags.get(kind) ?? "";
      expect(own).not.toBe("");
      expect(/\p{Extended_Pictographic}/u.test(own)).toBe(false);
      const others = ALL_KINDS.filter((k) => k !== kind).map((k) =>
        tags.get(k),
      );
      expect(others).not.toContain(own);
    },
  );
});

describe("the hub card", () => {
  const file = node({
    id: "file:app/acesso.py",
    kind: "file",
    label: "acesso.py",
    path: "app/acesso.py",
  });

  it("has a round back button that calls onBack and no › mark", () => {
    const onBack = vi.fn();
    const { container } = renderStep(file, { isHub: true, onBack });
    expect(container.querySelector(".open-mark")).toBeNull();
    expect(card(container).classList.contains("hub")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Nível anterior" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("has no back button without onBack (the top level)", () => {
    renderStep(file, { isHub: true });
    expect(screen.queryByRole("button", { name: "Nível anterior" })).toBeNull();
  });

  it("shows how many nodes its level has, in a badge", () => {
    renderStep(file, { isHub: true, childCount: 7 });
    expect(screen.getByTitle("7 nós").textContent).toBe("7");
  });

  it("says 1 nó for a level of one", () => {
    renderStep(file, { isHub: true, childCount: 1 });
    expect(screen.getByTitle("1 nó").textContent).toBe("1");
  });

  it("shows the count on a card that is not a hub, too", () => {
    const { container } = renderStep(file, { childCount: 7 });
    expect(screen.getByTitle("7 nós").textContent).toBe("7");
    expect(container.querySelector(".node")?.classList).toContain("has-count");
  });

  it("shows no count without one", () => {
    const { container } = renderStep(file);
    expect(container.querySelector(".hub-count")).toBeNull();
    expect(container.querySelector(".has-count")).toBeNull();
  });
});
