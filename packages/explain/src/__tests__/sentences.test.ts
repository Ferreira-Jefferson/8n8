import { describe, expect, it } from "vitest";
import type { Draft } from "../schema";
import { splitSentences, toClaims } from "../sentences";

describe("splitSentences (FID-05)", () => {
  it("cuts after '.', '!' and '?' followed by a space", () => {
    expect(
      splitSentences("Lê o peso. Calcula o frete! Devolve o valor? Fim."),
    ).toEqual(["Lê o peso.", "Calcula o frete!", "Devolve o valor?", "Fim."]);
  });

  it("does not cut inside 5.5, requests.get or a backticked `a. b`", () => {
    expect(
      splitSentences(
        "Usa a taxa 5.5 no cálculo. Chama requests.get uma vez. Lê `a. b` do código.",
      ),
    ).toEqual([
      "Usa a taxa 5.5 no cálculo.",
      "Chama requests.get uma vez.",
      "Lê `a. b` do código.",
    ]);
  });

  it("drops empty parts and trims spaces at the ends", () => {
    expect(splitSentences("  Lê o peso.   Calcula.  ")).toEqual([
      "Lê o peso.",
      "Calcula.",
    ]);
    expect(splitSentences("   ")).toEqual([]);
  });
});

const draft: Draft = {
  summary: "Busca a tabela. Dobra a taxa.",
  inputs: ["`peso`", "`distancia`"],
  outputs: ["valor do frete"],
  suggestions: [
    {
      command: "Guardar a tabela em cache",
      reason: "A função busca a tabela a cada chamada.",
      line: 2,
      severity: "media",
    },
    {
      command: "Validar o peso",
      reason: "Peso negativo gera frete negativo.",
      line: 1,
      severity: "baixa",
    },
  ],
};

describe("toClaims (FID-05, FID-09, FID-12)", () => {
  it("numbers sentences, inputs, outputs and suggestions in draft order", () => {
    expect(toClaims(draft)).toEqual([
      { id: "s1", text: "Busca a tabela.", kind: "sentence" },
      { id: "s2", text: "Dobra a taxa.", kind: "sentence" },
      { id: "i1", text: "`peso`", kind: "input" },
      { id: "i2", text: "`distancia`", kind: "input" },
      { id: "o1", text: "valor do frete", kind: "output" },
      {
        id: "g1",
        text: "Guardar a tabela em cache A função busca a tabela a cada chamada.",
        kind: "suggestion",
      },
      {
        id: "g2",
        text: "Validar o peso Peso negativo gera frete negativo.",
        kind: "suggestion",
      },
    ]);
  });

  it("generates no i* claim for a draft without inputs", () => {
    const ids = toClaims({ ...draft, inputs: [] }).map((c) => c.id);
    expect(ids).toEqual(["s1", "s2", "o1", "g1", "g2"]);
  });
});
