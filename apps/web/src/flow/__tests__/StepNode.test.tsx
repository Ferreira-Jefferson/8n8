import type { FlowNode } from "@code2n8n/model";
import { cleanup, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, describe, expect, it } from "vitest";
import { StepNode } from "../StepNode";

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

function renderStep(n: FlowNode, suggestionCount?: number) {
  return render(
    <ReactFlowProvider>
      <StepNode data={{ node: n, suggestionCount }} />
    </ReactFlowProvider>,
  );
}

describe("StepNode", () => {
  it("shows the node label", () => {
    renderStep(node());
    expect(screen.getByText("calcular_frete")).toBeTruthy();
  });

  it("shows the external category (CORE-12)", () => {
    renderStep(
      node({
        id: "fn:calcular_frete/s0",
        kind: "external",
        label: "requests.get",
        category: "HTTP",
        parentId: "fn:calcular_frete",
      }),
    );
    expect(screen.getByText("HTTP")).toBeTruthy();
  });

  it("shows the syntax error line (CORE-06)", () => {
    renderStep(node({ syntaxError: { line: 4 } }));
    expect(screen.getByText("Erro de sintaxe na linha 4")).toBeTruthy();
  });

  it("shows a badge with the suggestion count (CORE-23)", () => {
    renderStep(node(), 2);
    expect(screen.getByTitle("Sugestões").textContent).toBe("2");
  });

  it("shows no badge when the count is 0", () => {
    renderStep(node(), 0);
    expect(screen.queryByTitle("Sugestões")).toBeNull();
  });

  it("shows no badge when the count is absent", () => {
    renderStep(node());
    expect(screen.queryByTitle("Sugestões")).toBeNull();
  });
});
