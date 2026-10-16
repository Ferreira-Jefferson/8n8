import { describe, expect, it } from "vitest";
import type { FlowNode } from "../graph";
import { fold, searchText, searchWords } from "../search";

const node = (
  kind: FlowNode["kind"],
  label: string,
  path?: string,
): FlowNode => ({
  id: `n:${label}`,
  kind,
  label,
  parentId: null,
  range: { start: 1, end: 1 },
  openable: true,
  ...(path === undefined ? {} : { path }),
});

describe("fold", () => {
  it("drops case and accents, and takes _ - and blanks as one space, keeping the length", () => {
    expect(fold("Cálculo_de-Frete  X")).toBe("calculo de frete  x");
    expect(fold("Ação").length).toBe("Ação".length);
  });
});

describe("searchWords", () => {
  it("gives the folded words of a query, none for a blank one", () => {
    expect(searchWords("  Cálculo_de  Frete ")).toEqual([
      "calculo",
      "de",
      "frete",
    ]);
    expect(searchWords("   ")).toEqual([]);
  });
});

describe("searchText", () => {
  it("joins the provisional name and the technical name of a function", () => {
    expect(searchText(node("function", "Cliente.calcular_frete"))).toBe(
      "calcular frete cliente.calcular frete()",
    );
  });

  it("reads the path of a folder and of a file", () => {
    expect(searchText(node("folder", "frete", "app/frete"))).toBe(
      "frete app/frete/",
    );
    expect(searchText(node("file", "calculo.py", "app/calculo.py"))).toBe(
      "calculo.py app/calculo.py",
    );
  });

  it("reads the label of a loop and of a block twice, like the card", () => {
    expect(searchText(node("loop", "for item in itens"))).toBe(
      "for item in itens for item in itens",
    );
  });
});
