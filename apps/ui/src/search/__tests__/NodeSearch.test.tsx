import {
  act,
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
    expect(onPick).toHaveBeenCalledWith(ENTRIES[1]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Enter with no highlight picks the first result", () => {
    const { onPick } = setup();
    open();
    fireEvent.change(field(), { target: { value: "frete" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(ENTRIES[1]);
  });

  it("a click on a result picks it and closes", () => {
    const { onPick } = setup();
    open();
    fireEvent.click(screen.getAllByRole("option")[0] as HTMLElement);
    expect(onPick).toHaveBeenCalledWith(ENTRIES[0]);
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

describe("NodeSearch with the server", () => {
  const FAR: SearchEntry = {
    id: "far",
    title: "Cálculo de imposto",
    tech: "calcular_imposto()",
    where: "imposto.py · 1–9",
    ancestry: ["dir:x", "file:imposto.py"],
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  function setupRemote(remote: (q: string) => Promise<SearchEntry[]>) {
    const onPick = vi.fn();
    render(<NodeSearch entries={ENTRIES} remote={remote} onPick={onPick} />);
    return { onPick };
  }

  it("answers at once from the screen, asks the server after a pause and adds what it finds", async () => {
    vi.useFakeTimers();
    const remote = vi.fn(async () => [FAR]);
    setupRemote(remote);
    open();
    fireEvent.change(field(), { target: { value: "calcular" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(remote).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(remote).toHaveBeenCalledTimes(1);
    expect(remote).toHaveBeenCalledWith("calcular");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[1]?.textContent).toContain("calcular_imposto()");
  });

  it("asks once for a burst of keys and never for a blank query", async () => {
    vi.useFakeTimers();
    const remote = vi.fn(async () => []);
    setupRemote(remote);
    open();
    fireEvent.change(field(), { target: { value: "c" } });
    fireEvent.change(field(), { target: { value: "ca" } });
    fireEvent.change(field(), { target: { value: "cal" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(remote).toHaveBeenCalledTimes(1);
    expect(remote).toHaveBeenCalledWith("cal");
    fireEvent.change(field(), { target: { value: "  " } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(remote).toHaveBeenCalledTimes(1);
  });

  it("drops the answer to an old query", async () => {
    vi.useFakeTimers();
    let answerOld: (list: SearchEntry[]) => void = () => {};
    const remote = vi.fn(
      (q: string) =>
        new Promise<SearchEntry[]>((resolve) => {
          if (q === "imp") answerOld = resolve;
          else resolve([]);
        }),
    );
    setupRemote(remote);
    open();
    fireEvent.change(field(), { target: { value: "imp" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    fireEvent.change(field(), { target: { value: "frete" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await act(async () => answerOld([FAR]));
    expect(screen.queryByText("calcular_imposto()")).toBeNull();
  });

  it("hands the pick of a hit of the server, with its ancestry, to the screen", async () => {
    vi.useFakeTimers();
    const { onPick } = setupRemote(async () => [FAR]);
    open();
    fireEvent.change(field(), { target: { value: "imposto" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    fireEvent.click(screen.getAllByRole("option")[0] as HTMLElement);
    expect(onPick).toHaveBeenCalledWith(FAR);
  });
});
