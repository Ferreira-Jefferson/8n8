import { createHash } from "node:crypto";
import type { TitleItem } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { buildTitlePrompt, parseTitles, titleMessage } from "../title-prompt";
import { PY } from "./py";

describe("buildTitlePrompt (VID-14)", () => {
  it("starts with the exact role line the fake LLM recognizes", () => {
    const { text } = buildTitlePrompt("REGRAS PTS", PY);
    expect(text.split("\n")[0]).toBe(
      "Você escreve títulos de nós de um fluxo de código Python.",
    );
  });

  it("asks for at most 6 words, the PTS rules and JSON titles", () => {
    const { text } = buildTitlePrompt("REGRAS PTS", PY);
    expect(text).toContain("no máximo 6 palavras");
    expect(text).toContain("REGRAS PTS");
    expect(text).toContain('{"titles":[{"id":"n1","title":');
    expect(text).toContain("verbo no infinitivo");
    expect(text).toContain(
      "Não escreva número nem unidade (como kg, %, R$ ou segundos) que não aparece no código do nó.",
    );
  });

  it("versions the text with the first 12 hex chars of its sha256", () => {
    const { text, version } = buildTitlePrompt("regra A", PY);
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    expect(version).toBe(
      createHash("sha256").update(text).digest("hex").slice(0, 12),
    );
    expect(version).not.toBe(buildTitlePrompt("regra B", PY).version);
  });
});

const item = (overrides: Partial<TitleItem>): TitleItem => ({
  nodeId: "fn:x",
  cacheKey: "fn:x",
  language: "python",
  kind: "function",
  name: "x",
  code: "def x():\n    pass",
  range: { start: 1, end: 2 },
  calls: [],
  calledBy: [],
  ...overrides,
});

describe("titleMessage (VID-14)", () => {
  it("numbers the items n1..nk in order with kind, name, neighbours and numbered code", () => {
    const message = titleMessage([
      item({
        nodeId: "fn:processar_pedido",
        name: "processar_pedido",
        code: "def processar_pedido(req):\n    return calcular_frete(req)",
        range: { start: 10, end: 11 },
        calls: ["calcular_frete"],
      }),
      item({
        nodeId: "fn:calcular_frete/s0",
        kind: "external",
        name: "requests.get",
        code: '    r = requests.get("x")',
        range: { start: 5, end: 5 },
        calledBy: ["a", "b"],
      }),
    ]);
    expect(message).toBe(
      [
        "[n1] Tipo: função | Nome: processar_pedido",
        "Chama: calcular_frete",
        "Chamado por: nenhum",
        "Código:",
        "1 | def processar_pedido(req):",
        "2 |     return calcular_frete(req)",
        "",
        "[n2] Tipo: chamada externa | Nome: requests.get",
        "Chama: nenhum",
        "Chamado por: a, b",
        "Código:",
        '1 |     r = requests.get("x")',
      ].join("\n"),
    );
  });
});

describe("parseTitles (VID-14)", () => {
  it("reads titles from a fenced answer, trims them and drops empty ones", () => {
    const raw = [
      "```json",
      JSON.stringify({
        titles: [
          { id: "n1", title: "  Calcular frete  " },
          { id: "n2", title: "   " },
          { id: "n3", title: "Buscar UF pelo CEP" },
        ],
      }),
      "```",
    ].join("\n");
    expect(parseTitles(raw)).toEqual([
      { id: "n1", title: "Calcular frete" },
      { id: "n3", title: "Buscar UF pelo CEP" },
    ]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseTitles("isto não é JSON")).toThrow();
  });

  it("throws on JSON outside the schema", () => {
    expect(() => parseTitles('{"titles":[{"id":"n1"}]}')).toThrow();
    expect(() => parseTitles('{"titulos":[]}')).toThrow();
  });
});

describe("buildTitlePrompt docstring", () => {
  it("says the code comes without the docstring", () => {
    expect(buildTitlePrompt("regra A", PY).text).toContain("sem a docstring");
  });
});
