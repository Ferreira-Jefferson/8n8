import {
  type FlowNode,
  fold,
  SEARCHABLE_KINDS,
  searchText,
  searchWords,
} from "@8n8/model";
import { describe, expect, it } from "vitest";
import { lojaGraph } from "../../flow/__tests__/loja-graph";
import { mistaGraph } from "../../flow/__tests__/mista-graph";
import {
  highlight,
  hitEntryOf,
  matchEntries,
  mergeResults,
  type SearchEntry,
  searchEntries,
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

describe("searchEntries and the server's searchText", () => {
  it("read the same text in every searchable node, so a search finds the same nodes on either side", () => {
    for (const graph of [lojaGraph, mistaGraph]) {
      const entries = searchEntries(graph, new Map());
      const searchable = graph.nodes.filter((n) =>
        SEARCHABLE_KINDS.has(n.kind),
      );
      expect(entries.length).toBe(searchable.length);
      for (const [i, node] of searchable.entries()) {
        const e = entries[i] as SearchEntry;
        expect(searchText(node)).toBe(fold(`${e.title} ${e.tech}`));
      }
    }
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
    expect(other?.title).toBe("processar_pedido");
  });
});

describe("mergeResults", () => {
  const e = (id: string, title = id): SearchEntry => ({
    id,
    title,
    tech: id,
    where: "",
  });

  it("keeps the order of the server and gives the screen's entry, with its title, where both have the node", () => {
    const merged = mergeResults(
      [e("b", "Título revisado")],
      [e("a"), { ...e("b"), ancestry: ["p"] }, e("c")],
    );
    expect(merged.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(merged[1]).toMatchObject({
      title: "Título revisado",
      ancestry: ["p"],
    });
  });

  it("puts first what only the screen found, by a title, and keeps to the limit", () => {
    const merged = mergeResults(
      [e("x", "só pelo título")],
      [e("a"), e("b"), e("c")],
      3,
    );
    expect(merged.map((x) => x.id)).toEqual(["x", "a", "b"]);
  });

  it("keeps a hit on a name inside a node as it came, beside the node's own entry", () => {
    const named: SearchEntry = { ...e("b", "GET /api/x"), named: true };
    const merged = mergeResults([e("b", "Título revisado")], [named]);
    expect(merged.map((x) => x.title)).toEqual([
      "Título revisado",
      "GET /api/x",
    ]);
  });
});

describe("hitEntryOf", () => {
  const code: FlowNode = {
    id: "file:src/app.ts/mod/s2",
    kind: "code",
    label: "app.get",
    parentId: "file:src/app.ts/mod",
    range: { start: 8, end: 9 },
    openable: false,
  };

  it("shows the name the server found and its line, not the node's", () => {
    expect(
      hitEntryOf(
        {
          node: code,
          ancestry: ["dir:src", "file:src/app.ts", "file:src/app.ts/mod"],
          name: "GET /api/project",
          line: 9,
        },
        "src/app.ts",
      ),
    ).toEqual({
      id: "file:src/app.ts/mod/s2",
      title: "GET /api/project",
      tech: "",
      where: "app.ts · 9",
      ancestry: ["dir:src", "file:src/app.ts", "file:src/app.ts/mod"],
      named: true,
    });
  });

  it("is the node's own entry for a hit on the node", () => {
    const fn: FlowNode = { ...code, id: "f", kind: "function", label: "ler" };
    expect(hitEntryOf({ node: fn, ancestry: ["p"] }, "src/app.ts")).toEqual({
      id: "f",
      title: "ler",
      tech: "ler()",
      where: "app.ts · 8–9",
      ancestry: ["p"],
    });
  });
});
