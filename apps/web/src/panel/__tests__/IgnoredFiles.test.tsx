import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { IgnoredFiles } from "../IgnoredFiles";

afterEach(cleanup);

describe("IgnoredFiles (PROJ-06)", () => {
  it("draws no section for an empty list", () => {
    const { container } = render(<IgnoredFiles ignored={[]} />);
    expect(
      screen.queryByRole("region", { name: "Arquivos ignorados" }),
    ).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("lists each file with its reason, in the order received", () => {
    render(
      <IgnoredFiles
        ignored={[
          { path: "grande.py", reason: "too-large" },
          { path: "latin1.py", reason: "not-utf8" },
          { path: "travado.py", reason: "unreadable" },
          { path: "link.py", reason: "symlink" },
        ]}
      />,
    );
    const section = screen.getByRole("region", { name: "Arquivos ignorados" });
    const items = within(section)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items).toEqual([
      "grande.py — maior que 1 MB",
      "latin1.py — não está em UTF-8",
      "travado.py — não foi possível ler",
      "link.py — link simbólico não seguido",
    ]);
  });
});
