import type { FlowNode, Graph } from "@code2n8n/model";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lojaGraph } from "../../flow/__tests__/loja-graph";
import { Breadcrumb } from "../Breadcrumb";
import { ancestry } from "../navigation";

afterEach(cleanup);

function node(id: string, label: string, parentId: string | null): FlowNode {
  return {
    id,
    kind: parentId === null ? "function" : "loop",
    label,
    parentId,
    range: { start: 1, end: 2 },
    openable: true,
  };
}

const graph: Graph = {
  language: "python",
  empty: false,
  nodes: [
    node("fn:calcular_frete", "calcular_frete", null),
    node("fn:calcular_frete/s1", "for item in itens", "fn:calcular_frete"),
  ],
  edges: [],
};
const path = ["fn:calcular_frete", "fn:calcular_frete/s1"];

const nav = () => screen.getByRole("navigation");

describe("Breadcrumb", () => {
  it("shows Trecho › calcular_frete › for item in itens for the path fn:calcular_frete › loop", () => {
    render(<Breadcrumb graph={graph} path={path} onGoTo={() => {}} />);
    expect(nav().textContent).toBe(
      "Trecho › calcular_frete › for item in itens",
    );
  });

  it("calls onGoTo(0) for Trecho and onGoTo(1) for calcular_frete", () => {
    const onGoTo = vi.fn();
    render(<Breadcrumb graph={graph} path={path} onGoTo={onGoTo} />);
    fireEvent.click(screen.getByRole("button", { name: "Trecho" }));
    expect(onGoTo).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "calcular_frete" }));
    expect(onGoTo).toHaveBeenLastCalledWith(1);
  });

  it("shows only Trecho at the top level", () => {
    render(<Breadcrumb graph={graph} path={[]} onGoTo={() => {}} />);
    expect(nav().textContent).toBe("Trecho");
  });
});

describe("Breadcrumb on a project (PROJ-02, 04)", () => {
  const lojaPath = ancestry(
    lojaGraph,
    "file:frete/calculo.py/fn:calcular_frete",
  );

  it("starts with the project name and follows the folder and file labels", () => {
    render(<Breadcrumb graph={lojaGraph} path={lojaPath} onGoTo={() => {}} />);
    expect(nav().textContent).toBe(
      "loja › frete › calculo.py › calcular_frete",
    );
  });

  it("calls onGoTo(0) for the project name", () => {
    const onGoTo = vi.fn();
    render(<Breadcrumb graph={lojaGraph} path={lojaPath} onGoTo={onGoTo} />);
    fireEvent.click(screen.getByRole("button", { name: "loja" }));
    expect(onGoTo).toHaveBeenLastCalledWith(0);
  });
});
