import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchEntry } from "../match";
import { NodeSearch } from "../NodeSearch";

const ENTRIES: SearchEntry[] = [
  {
    id: "a",
    title: "Cadastro de produtos",
    tech: "cadastro_produto()",
    where: "produtos.py · 8–24",
  },
  {
    id: "b",
    title: "Cálculo de frete",
    tech: "calcular_frete()",
    where: "frete.py · 40–45",
  },
];

afterEach(cleanup);

function setup() {
  const onPick = vi.fn();
  render(
    <>
      <button type="button">fora</button>
      <NodeSearch entries={ENTRIES} onPick={onPick} />
    </>,
  );
  return { onPick };
}

const lupa = () => screen.getByRole("button", { name: "Buscar nó" });
const open = () => fireEvent.click(lupa());
const field = () => screen.getByRole("combobox", { name: "Buscar nó" });
const selected = (i: number) =>
  screen.getAllByRole("option")[i]?.getAttribute("aria-selected");

describe("NodeSearch", () => {
  it("starts closed: only the magnifier, no list", () => {
    setup();
    expect(lupa().getAttribute("aria-expanded")).toBe("false");
    expect(field().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens on a click, focuses the field and lists the nodes", () => {
    setup();
    open();
    expect(field().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(field());
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("filters by title or technical name and marks what it found", () => {
    setup();
    open();
    fireEvent.change(field(), { target: { value: "calcular" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]?.querySelector("mark")?.textContent).toBe("calcular");
    expect(
      within(options[0] as HTMLElement).getByText("frete.py · 40–45"),
    ).toBeTruthy();
    fireEvent.change(field(), { target: { value: "produtos" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("says so when nothing matches", () => {
    setup();
    open();
    fireEvent.change(field(), { target: { value: "zzz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("Nenhum nó achado.")).toBeTruthy();
  });

  it("moves the highlight with the arrows, wrapping, and Enter picks it", () => {
    const { onPick } = setup();
    open();
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(selected(0)).toBe("true");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(selected(1)).toBe("true");
    expect(field().getAttribute("aria-activedescendant")).toBe(
      screen.getAllByRole("option")[1]?.id,
    );
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(selected(0)).toBe("true");
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(selected(1)).toBe("true");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Enter with no highlight picks the first result", () => {
    const { onPick } = setup();
    open();
    fireEvent.change(field(), { target: { value: "frete" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("b");
  });

  it("a click on a result picks it and closes", () => {
    const { onPick } = setup();
    open();
    fireEvent.click(screen.getAllByRole("option")[0] as HTMLElement);
    expect(onPick).toHaveBeenCalledWith("a");
    expect(field().getAttribute("aria-expanded")).toBe("false");
  });

  it("Esc closes and clears the query", () => {
    setup();
    open();
    fireEvent.change(field(), { target: { value: "frete" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(field().getAttribute("aria-expanded")).toBe("false");
    open();
    expect((field() as HTMLInputElement).value).toBe("");
  });

  it("a click outside closes it", () => {
    setup();
    open();
    fireEvent.mouseDown(screen.getByRole("button", { name: "fora" }));
    expect(field().getAttribute("aria-expanded")).toBe("false");
  });
});
