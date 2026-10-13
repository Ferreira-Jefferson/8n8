import { describe, expect, it } from "vitest";
import {
  type CheckContext,
  checkIdentifiers,
  checkNumbers,
  checkUnits,
  layerOne,
  UNITS,
} from "../checks";

const ctx = (code: string, neighbours: string[] = []): CheckContext => ({
  code,
  neighbours,
});

describe("UNITS", () => {
  it("is the unit list of the spec", () => {
    expect([...UNITS]).toEqual([
      "kg",
      "g",
      "mg",
      "t",
      "km",
      "m",
      "cm",
      "mm",
      "l",
      "ml",
      "R$",
      "US$",
      "€",
      "%",
      "ms",
      "s",
      "seg",
      "segundos",
      "min",
      "minutos",
      "h",
      "horas",
      "dias",
      "KB",
      "MB",
      "GB",
    ]);
  });
});

describe("checkNumbers (FID-02)", () => {
  it("flags a number absent from the code", () => {
    expect(
      checkNumbers(
        "A caixa pesa 5 kg.",
        ctx("def f(caixa):\n    return caixa.peso"),
      ),
    ).not.toBeNull();
  });

  it("accepts a number that is a numeric token of the code", () => {
    expect(
      checkNumbers(
        "Dobra a taxa acima de 30.",
        ctx("if peso > 30:\n    taxa *= 2"),
      ),
    ).toBeNull();
  });

  it("does not accept 5 just because the code has 0.5", () => {
    expect(
      checkNumbers("Usa 5 como fator.", ctx("fator = 0.5")),
    ).not.toBeNull();
  });

  it("matches 0,5 in the text with 0.5 in the code", () => {
    expect(checkNumbers("Usa o fator 0,5.", ctx("fator = 0.5"))).toBeNull();
  });

  it("accepts a number inside a neighbour name, but not the same number on its own", () => {
    const c = ctx("def f():\n    etapa2()", ["etapa2"]);
    expect(checkNumbers("Chama etapa2 no fim.", c)).toBeNull();
    expect(checkNumbers("Repete 2 vezes.", c)).not.toBeNull();
  });

  it("ignores numbers between backticks", () => {
    expect(
      checkNumbers("Lê `campo_7` do pedido.", ctx("x = pedido")),
    ).toBeNull();
  });
});

describe("checkUnits (FID-03)", () => {
  it("flags kg when the code has no kg", () => {
    expect(checkUnits("Pesa 5 kg.", ctx("return caixa.peso"))).not.toBeNull();
  });

  it("accepts kg found in a comment or in a string of the code", () => {
    expect(checkUnits("Pesa em kg.", ctx("peso = 1  # em kg"))).toBeNull();
    expect(checkUnits("Pesa em kg.", ctx('rotulo = "kg"'))).toBeNull();
  });

  it("accepts a unit glued to a number in the code", () => {
    expect(checkUnits("Espera 30 s.", ctx('timeout = "30s"'))).toBeNull();
  });

  it("accepts dias when the code has dias_uteis", () => {
    expect(checkUnits("Conta os dias.", ctx("dias_uteis = 5"))).toBeNull();
  });

  it("counts R$, % and € in any position", () => {
    const code = ctx("valor = preco * taxa");
    expect(checkUnits("Devolve o valor em R$.", code)).not.toBeNull();
    expect(checkUnits("Aplica a taxa%.", code)).not.toBeNull();
    expect(checkUnits("€ por item.", code)).not.toBeNull();
    expect(
      checkUnits("Devolve o valor em R$.", ctx('moeda = "R$"')),
    ).toBeNull();
    expect(checkUnits("Aplica 10%.", ctx("x = y % 2"))).toBeNull();
  });

  it("flags 5 g and 5g when the code has no g", () => {
    const code = ctx("return caixa.peso");
    expect(checkUnits("Pesa 5 g.", code)).not.toBeNull();
    expect(checkUnits("Pesa 5g.", code)).not.toBeNull();
    expect(checkUnits("Pesa 5 g.", ctx('unidade = "g"'))).toBeNull();
  });

  it("does not flag 'a gente' or a lone m without a number before", () => {
    const code = ctx("return caixa.peso");
    expect(checkUnits("Aqui a gente lê o peso.", code)).toBeNull();
    expect(checkUnits("O valor m vem do pedido.", code)).toBeNull();
  });

  it("matches a letter unit as a code token, not as a substring (FID-03)", () => {
    expect(checkUnits("Espera 30 s.", ctx("status = 30"))).not.toBeNull();
    expect(checkUnits("Mede 2 m.", ctx("item = 2"))).not.toBeNull();
  });

  it("ignores case", () => {
    expect(checkUnits("Pesa 5 KG.", ctx("peso_kg = 5"))).toBeNull();
    expect(checkUnits("Lê 5 mb.", ctx("limite = 5"))).not.toBeNull();
    expect(checkUnits("Lê 5 mb.", ctx("LIMITE_MB = 5"))).toBeNull();
  });
});

describe("checkIdentifiers (FID-04)", () => {
  it("accepts `requests.get` when the code has requests.get(", () => {
    expect(
      checkIdentifiers(
        "Busca a tabela com `requests.get`.",
        ctx('tabela = requests.get("https://x")'),
      ),
    ).toBeNull();
  });

  it("checks `calcular()` without the (...)", () => {
    expect(
      checkIdentifiers("Chama `calcular()`.", ctx("calcular(1)")),
    ).toBeNull();
    expect(
      checkIdentifiers("Chama `somar()`.", ctx("calcular(1)")),
    ).not.toBeNull();
  });

  it("accepts a neighbour name", () => {
    expect(
      checkIdentifiers(
        "É chamada por `processar`.",
        ctx("x = 1", ["processar"]),
      ),
    ).toBeNull();
  });

  it("flags `peso_total` when the code only has peso (identifier boundary)", () => {
    expect(
      checkIdentifiers("Soma `peso_total`.", ctx("return peso * 2")),
    ).not.toBeNull();
    expect(
      checkIdentifiers("Usa `peso`.", ctx("return peso_total")),
    ).not.toBeNull();
  });
});

describe("layerOne (FID-02, FID-03, FID-04)", () => {
  it("returns one problem per failed claim, with its id and text", () => {
    const problems = layerOne(
      [
        { id: "s1", text: "Devolve o peso da caixa.", kind: "sentence" },
        { id: "s2", text: "A caixa pesa 5 kg.", kind: "sentence" },
        { id: "i1", text: "`caixa`", kind: "input" },
        { id: "o1", text: "`peso_total`", kind: "output" },
      ],
      ctx("def pesar_caixa(caixa):\n    return caixa.peso"),
    );
    expect(problems.map((p) => [p.id, p.text])).toEqual([
      ["s2", "A caixa pesa 5 kg."],
      ["o1", "`peso_total`"],
    ]);
    expect(problems[0]?.problem).toContain("5");
    expect(problems[0]?.problem).toContain("kg");
    expect(problems[1]?.problem).toContain("peso_total");
  });

  it("returns no problem for faithful claims", () => {
    expect(
      layerOne(
        [{ id: "s1", text: "Dobra a taxa acima de 30.", kind: "sentence" }],
        ctx("if peso > 30:\n    taxa *= 2"),
      ),
    ).toEqual([]);
  });
});
