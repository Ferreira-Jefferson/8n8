import type { FlowNode, NodeKind } from "@code2n8n/model";
import { cleanup, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, describe, expect, it } from "vitest";
import { StepNode, type StepNodeData } from "../StepNode";

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
    hasIn: true,
    hasOut: true,
    enterAt: 0,
    selected: false,
    dimmed: false,
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
    const of = (type: string) =>
      handles.find((h) => h.classList.contains(`port-${type}`));
    return { in: of("in"), out: of("out") };
  }

  it("shows both ports when the card has wires on both sides", () => {
    const { container } = renderStep(node());
    const p = ports(container);
    expect(p.in?.style.visibility).toBe("visible");
    expect(p.out?.style.visibility).toBe("visible");
  });

  it("hides the input port with hasIn=false", () => {
    const { container } = renderStep(node(), { hasIn: false });
    const p = ports(container);
    expect(p.in?.style.visibility).toBe("hidden");
    expect(p.out?.style.visibility).toBe("visible");
  });

  it("hides the output port with hasOut=false", () => {
    const { container } = renderStep(node(), { hasOut: false });
    const p = ports(container);
    expect(p.in?.style.visibility).toBe("visible");
    expect(p.out?.style.visibility).toBe("hidden");
  });
});

describe("StepNode selection and dimming (VID-22, VID-32)", () => {
  it("adds on when selected and nothing else", () => {
    const { container } = renderStep(node(), { selected: true });
    expect(card(container).classList.contains("on")).toBe(true);
    expect(card(container).classList.contains("dim")).toBe(false);
  });

  it("adds dim when dimmed", () => {
    const { container } = renderStep(node(), { dimmed: true });
    expect(card(container).classList.contains("dim")).toBe(true);
    expect(card(container).classList.contains("on")).toBe(false);
  });
});

describe("StepNode badges (CORE-06, CORE-23)", () => {
  it("shows the syntax error line (CORE-06)", () => {
    renderStep(node({ syntaxError: { line: 4 } }));
    expect(screen.getByText("Erro de sintaxe na linha 4")).toBeTruthy();
  });

  it("shows a badge with the suggestion count (CORE-23)", () => {
    renderStep(node(), { suggestionCount: 2 });
    expect(screen.getByTitle("Sugestões").textContent).toBe("2");
  });

  it("shows no badge when the count is 0", () => {
    renderStep(node(), { suggestionCount: 0 });
    expect(screen.queryByTitle("Sugestões")).toBeNull();
  });

  it("shows no badge when the count is absent", () => {
    renderStep(node());
    expect(screen.queryByTitle("Sugestões")).toBeNull();
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
