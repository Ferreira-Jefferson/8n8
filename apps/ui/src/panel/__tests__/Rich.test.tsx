import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { blocksOf, Rich, RichInline } from "../Rich";

describe("Rich", () => {
  it("turns backticks into code and asterisks into bold and italic, with no mark left", () => {
    const { container } = render(
      <Rich text="Chama `trim()` com **cuidado** e *calma* e _isso_." />,
    );
    expect(container.querySelector("code")?.textContent).toBe("trim()");
    expect(container.querySelector("strong")?.textContent).toBe("cuidado");
    expect(
      [...container.querySelectorAll("em")].map((e) => e.textContent),
    ).toEqual(["calma", "isso"]);
    expect(container.textContent).not.toMatch(/[`*]/);
  });

  it("makes a list of lines that start with a dash, even when the model flattened it", () => {
    const flat = "Cinco tarefas: - `a()` corta. - `b()` troca. - `c()` mede.";
    expect(blocksOf(flat)).toEqual([
      { kind: "p", lines: ["Cinco tarefas:"] },
      { kind: "ul", items: ["`a()` corta.", "`b()` troca.", "`c()` mede."] },
    ]);
    const { container } = render(<Rich text={"Veja:\n- um\n- dois\n\nFim."} />);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("keeps snake_case and a lone asterisk as written, and never builds HTML", () => {
    const { container } = render(
      <Rich text="O campo peso_kg vale 2 * 3 <b>x</b>" />,
    );
    expect(container.textContent).toBe("O campo peso_kg vale 2 * 3 <b>x</b>");
    expect(container.querySelector("b")).toBeNull();
  });

  it("shapes a short text with no block", () => {
    const { container } = render(<RichInline text="Use `fetch` **já**" />);
    expect(container.querySelector("code")?.textContent).toBe("fetch");
    expect(container.querySelector("strong")?.textContent).toBe("já");
  });
});
