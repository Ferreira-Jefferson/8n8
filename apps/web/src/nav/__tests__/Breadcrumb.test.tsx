import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lojaGraph } from "../../flow/__tests__/loja-graph";
import { videoGraph } from "../../flow/__tests__/video-graph";
import { Breadcrumb } from "../Breadcrumb";
import { ancestry, type Opened } from "../navigation";

afterEach(cleanup);

const P = "fn:processar_pedido";
const C = "fn:calcular_frete";
const path: Opened[] = [
  { id: P, via: P },
  { id: C, via: `${P}/s3` },
];

const nav = () => screen.getByRole("navigation");

describe("Breadcrumb on a snippet (VID-19)", () => {
  it("shows Fluxo principal › Calcular frete with the title of the card clicked", () => {
    render(
      <Breadcrumb
        graph={videoGraph}
        path={[{ id: C, via: `${P}/s3` }]}
        titles={new Map([[`${P}/s3`, "Calcular frete"]])}
        onGoTo={() => {}}
      />,
    );
    expect(nav().textContent).toBe("Fluxo principal › Calcular frete");
  });

  it("uses the reviewed title of each via", () => {
    render(
      <Breadcrumb
        graph={videoGraph}
        path={path}
        titles={
          new Map([
            [P, "Processa o pedido"],
            [`${P}/s3`, "Calcula o frete"],
          ])
        }
        onGoTo={() => {}}
      />,
    );
    expect(nav().textContent).toBe(
      "Fluxo principal › Processa o pedido › Calcula o frete",
    );
  });

  it("keeps the full name of each item in its title, for the items cut with …", () => {
    render(
      <Breadcrumb
        graph={videoGraph}
        path={path}
        titles={
          new Map([
            [P, "Processa o pedido"],
            [`${P}/s3`, "Calcula o frete"],
          ])
        }
        onGoTo={() => {}}
      />,
    );
    expect(
      screen.getAllByRole("button").map((b) => b.getAttribute("title")),
    ).toEqual(["Fluxo principal", "Processa o pedido", "Calcula o frete"]);
  });

  it("uses the provisional name of the via without a title (VID-15)", () => {
    render(
      <Breadcrumb
        graph={videoGraph}
        path={path}
        titles={new Map()}
        onGoTo={() => {}}
      />,
    );
    expect(nav().textContent).toBe(
      "Fluxo principal › Processar pedido › Calcular frete",
    );
  });

  it("shows only Fluxo principal at the top level", () => {
    render(
      <Breadcrumb
        graph={videoGraph}
        path={[]}
        titles={new Map()}
        onGoTo={() => {}}
      />,
    );
    expect(nav().textContent).toBe("Fluxo principal");
  });

  it("calls onGoTo(i) for each item", () => {
    const onGoTo = vi.fn();
    render(
      <Breadcrumb
        graph={videoGraph}
        path={path}
        titles={new Map()}
        onGoTo={onGoTo}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fluxo principal" }));
    expect(onGoTo).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "Processar pedido" }));
    expect(onGoTo).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Calcular frete" }));
    expect(onGoTo).toHaveBeenLastCalledWith(2);
  });
});

describe("Breadcrumb on a project (PROJ-02, 04)", () => {
  const lojaPath: Opened[] = ancestry(
    lojaGraph,
    "file:frete/calculo.py/fn:calcular_frete",
  ).map((id) => ({ id, via: id }));

  it("starts with the project name and follows the folder and file names", () => {
    render(
      <Breadcrumb
        graph={lojaGraph}
        path={lojaPath}
        titles={new Map()}
        onGoTo={() => {}}
      />,
    );
    expect(nav().textContent).toBe(
      "loja › frete › calculo.py › Calcular frete",
    );
  });

  it("calls onGoTo(0) for the project name", () => {
    const onGoTo = vi.fn();
    render(
      <Breadcrumb
        graph={lojaGraph}
        path={lojaPath}
        titles={new Map()}
        onGoTo={onGoTo}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "loja" }));
    expect(onGoTo).toHaveBeenLastCalledWith(0);
  });
});
