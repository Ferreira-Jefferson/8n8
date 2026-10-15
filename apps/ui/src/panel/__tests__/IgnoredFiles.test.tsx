import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IgnoredFiles } from "../IgnoredFiles";

afterEach(cleanup);

const four = [
  { path: "grande.py", reason: "too-large", addable: true },
  { path: "latin1.py", reason: "not-utf8" },
  { path: "travado.py", reason: "unreadable" },
  { path: "link.py", reason: "symlink" },
] as const;

const list = () => screen.queryByRole("region", { name: "Arquivos ignorados" });

describe("IgnoredFiles (PROJ-06, CLEAN-04..06)", () => {
  it("draws nothing for an empty list", () => {
    const { container } = render(<IgnoredFiles ignored={[]} onAdd={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("is an icon whose hover text counts the files, with the list closed (CLEAN-04)", () => {
    render(<IgnoredFiles ignored={[...four]} onAdd={vi.fn()} />);
    const icon = screen.getByRole("button", { name: "4 arquivos ignorados" });
    expect(icon.getAttribute("aria-expanded")).toBe("false");
    expect(icon.textContent).toBe("4 arquivos ignorados");
    expect(list()).toBeNull();
  });

  it("says 1 arquivo ignorado for one file", () => {
    render(
      <IgnoredFiles
        ignored={[{ path: "a.py", reason: "not-utf8" }]}
        onAdd={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "1 arquivo ignorado" }),
    ).toBeTruthy();
  });

  it("a click opens the list, each file with its reason, in the order received; another click closes it (CLEAN-05)", () => {
    render(<IgnoredFiles ignored={[...four]} onAdd={vi.fn()} />);
    const icon = screen.getByRole("button", { name: "4 arquivos ignorados" });
    fireEvent.click(icon);
    expect(icon.getAttribute("aria-expanded")).toBe("true");
    const items = within(list() as HTMLElement)
      .getAllByRole("listitem")
      .map((li) => [
        li.querySelector(".ignored-path")?.textContent,
        li.querySelector(".ignored-reason")?.textContent,
      ]);
    expect(items).toEqual([
      ["grande.py", "maior que 1 MB"],
      ["latin1.py", "não está em UTF-8"],
      ["travado.py", "não foi possível ler"],
      ["link.py", "link simbólico não seguido"],
    ]);
    fireEvent.click(icon);
    expect(list()).toBeNull();
  });

  it("offers Adicionar ao mapa only for an addable file, and hands its path over (CLEAN-06)", () => {
    const onAdd = vi.fn();
    render(
      <IgnoredFiles
        ignored={[
          ...four,
          { path: "enorme.py", reason: "too-large", addable: false },
        ]}
        onAdd={onAdd}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "5 arquivos ignorados" }),
    );
    const adds = within(list() as HTMLElement).getAllByRole("button", {
      name: "Adicionar ao mapa",
    });
    expect(adds).toHaveLength(1);
    expect(
      adds[0]?.closest("li")?.querySelector(".ignored-path")?.textContent,
    ).toBe("grande.py");
    fireEvent.click(adds[0] as HTMLElement);
    expect(onAdd).toHaveBeenCalledWith("grande.py");
  });
});
