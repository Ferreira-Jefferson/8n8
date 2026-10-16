import { describe, expect, it } from "vitest";
import { lojaGraph } from "../../flow/__tests__/loja-graph";
import {
  fold,
  highlight,
  matchEntries,
  type SearchEntry,
  searchEntries,
  searchWords,
} from "../match";

const entry = (title: string, tech: string): SearchEntry => ({
  id: tech,
  title,
  tech,
  where: "",
});

const ENTRIES = [
  entry("Cadastro de produtos", "cadastro_produto()"),
  entry("Cálculo de frete", "calcular_frete()"),
  entry("Envio de e-mail", "enviar_email()"),
];

const ids = (list: SearchEntry[]) => list.map((e) => e.id);

describe("fold", () => {
  it("drops case and accents, and takes _ - and blanks as one space, keeping the length", () => {
    expect(fold("Cálculo_de-Frete  X")).toBe("calculo de frete  x");
    expect(fold("Ação").length).toBe("Ação".length);
  });
});

describe("matchEntries", () => {
  it("finds by the technical name, even with the title rewritten", () => {
    expect(ids(matchEntries(ENTRIES, "cadastro_prod"))).toEqual([
      "cadastro_produto()",
    ]);
  });

  it("finds by the reviewed title", () => {
    expect(ids(matchEntries(ENTRIES, "produtos"))).toEqual([
      "cadastro_produto()",
    ]);
  });

  it("ignores case and accents", () => {
    expect(ids(matchEntries(ENTRIES, "CALCULO"))).toEqual(["calcular_frete()"]);
    expect(ids(matchEntries(ENTRIES, "cálc"))).toEqual(["calcular_frete()"]);
  });

  it("takes a space, _ and - as the same", () => {
    expect(ids(matchEntries(ENTRIES, "cadastro produto"))).toEqual([
      "cadastro_produto()",
    ]);
    expect(ids(matchEntries(ENTRIES, "e-mail"))).toEqual(["enviar_email()"]);
    expect(ids(matchEntries(ENTRIES, "enviar email"))).toEqual([
      "enviar_email()",
    ]);
  });

  it("needs every word, each one in the title or in the technical name", () => {
    expect(ids(matchEntries(ENTRIES, "frete calcular"))).toEqual([
      "calcular_frete()",
    ]);
    // "produtos" is in the title and "cadastro_produto" in the name: both count.
    expect(ids(matchEntries(ENTRIES, "produtos cadastro_produto"))).toEqual([
      "cadastro_produto()",
    ]);
    expect(matchEntries(ENTRIES, "frete email")).toEqual([]);
  });

  it("lists everything for a blank query, up to the limit", () => {
    expect(matchEntries(ENTRIES, "  ")).toHaveLength(3);
    expect(matchEntries(ENTRIES, "", 2)).toHaveLength(2);
  });

  it("returns nothing when no node has the words", () => {
    expect(matchEntries(ENTRIES, "zzz")).toEqual([]);
  });
});

describe("highlight", () => {
  it("marks the stretch found, in the original text", () => {
    expect(highlight("Cálculo de frete", searchWords("calculo"))).toEqual([
      { text: "Cálculo", hit: true },
      { text: " de frete", hit: false },
    ]);
  });

  it("marks a name across the _ and leaves the rest", () => {
    expect(
      highlight("cadastro_produto", searchWords("cadastro produto")),
    ).toEqual([
      { text: "cadastro", hit: true },
      { text: "_", hit: false },
      { text: "produto", hit: true },
    ]);
    expect(highlight("a_frete_b", searchWords("frete"))).toEqual([
      { text: "a_", hit: false },
      { text: "frete", hit: true },
      { text: "_b", hit: false },
    ]);
  });

  it("marks nothing for no words", () => {
    expect(highlight("frete", [])).toEqual([{ text: "frete", hit: false }]);
  });
});

describe("searchEntries", () => {
  it("lists the named nodes of every level, with the title, the name and where", () => {
    const id = "file:frete/calculo.py/fn:calcular_frete";
    const list = searchEntries(lojaGraph, new Map([[id, "Cálculo de frete"]]));
    const fn = list.find((e) => e.id === id);
    expect(fn?.title).toBe("Cálculo de frete");
    expect(fn?.tech).toBe("calcular_frete()");
    expect(fn?.where).toMatch(/^calculo\.py · \d+/);
    const folder = list.find((e) => e.id === "dir:frete");
    expect(folder).toMatchObject({ tech: "frete/", where: "PASTA" });
    // A reviewed title only exists for the levels already opened: the rest keeps the provisional name.
    const other = list.find((e) => e.tech === "processar_pedido()");
    expect(other?.title).toBe("Processar pedido");
  });
});
