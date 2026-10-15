import type { ExternalCategory, FlowNode, Graph, NodeKind } from "@8n8/model";
import { describe, expect, it } from "vitest";
import {
  categoryTag,
  codeLineOf,
  isOpenable,
  provisionalLabel,
  tagOf,
} from "../card";

function node(
  kind: NodeKind,
  label: string,
  extra: Partial<FlowNode> = {},
): FlowNode {
  return {
    id: `x:${label}`,
    kind,
    label,
    parentId: null,
    range: { start: 1, end: 1 },
    openable: false,
    ...extra,
  };
}

const source = [
  "def calcular_frete(pedido, cep):",
  "    if peso > 30:",
  "        return TABELA_PESADA[uf]",
  '    return {"ok": True, "total": total}',
  "    a = 1",
  "",
].join("\n");

describe("VID-04: tagOf", () => {
  it("names each kind with the label of the table", () => {
    expect(tagOf(node("function", "f"), false)).toBe("FUNÇÃO");
    expect(tagOf(node("class", "K"), false)).toBe("FUNÇÃO");
    expect(tagOf(node("call", "f", { target: "fn:f" }), false)).toBe("FUNÇÃO");
    expect(tagOf(node("condition", "a > 1"), false)).toBe("SE");
    expect(tagOf(node("loop", "for x in y"), false)).toBe("LAÇO");
    expect(tagOf(node("block", "with x"), false)).toBe("BLOCO");
    expect(tagOf(node("code", "Código"), false)).toBe("CÓDIGO");
    expect(tagOf(node("return", "a"), false)).toBe("RETORNO");
    expect(tagOf(node("folder", "frete"), false)).toBe("PASTA");
    expect(tagOf(node("file", "a.py"), false)).toBe("ARQUIVO");
    expect(tagOf(node("module", "Módulo"), false)).toBe("CÓDIGO SOLTO");
  });

  it("names an external node by its category, with DISCO and E-MAIL", () => {
    const ext = (category: ExternalCategory) =>
      tagOf(node("external", "x", { category }), false);
    expect(ext("HTTP")).toBe("HTTP");
    expect(ext("BANCO")).toBe("BANCO");
    expect(ext("ARQUIVO")).toBe("DISCO");
    expect(ext("EMAIL")).toBe("E-MAIL");
    expect(ext("EXTERNO")).toBe("EXTERNO");
  });

  it("names any entry GATILHO", () => {
    expect(tagOf(node("function", "f"), true)).toBe("GATILHO");
    expect(tagOf(node("module", "Módulo"), true)).toBe("GATILHO");
  });
});

describe("VID-04: categoryTag", () => {
  it("swaps ARQUIVO for DISCO and EMAIL for E-MAIL", () => {
    expect(categoryTag("HTTP")).toBe("HTTP");
    expect(categoryTag("BANCO")).toBe("BANCO");
    expect(categoryTag("ARQUIVO")).toBe("DISCO");
    expect(categoryTag("EMAIL")).toBe("E-MAIL");
    expect(categoryTag("EXTERNO")).toBe("EXTERNO");
  });
});

describe("VID-15: provisionalLabel", () => {
  it("turns a function or call name into words", () => {
    expect(provisionalLabel(node("function", "calcular_frete"))).toBe(
      "Calcular frete",
    );
    expect(
      provisionalLabel(
        node("call", "calcular_frete", { target: "fn:calcular_frete" }),
      ),
    ).toBe("Calcular frete");
    expect(provisionalLabel(node("class", "Pedido"))).toBe("Pedido");
  });

  it("keeps only the last segment of an external name", () => {
    expect(
      provisionalLabel(node("external", "db.salvar", { category: "BANCO" })),
    ).toBe("Salvar");
    expect(
      provisionalLabel(
        node("external", "db.buscar_cliente", { category: "BANCO" }),
      ),
    ).toBe("Buscar cliente");
  });

  it("uses the condition text, Código, Retorno and Código solto", () => {
    expect(provisionalLabel(node("condition", "peso > 30"))).toBe("peso > 30");
    expect(provisionalLabel(node("code", "Código"))).toBe("Código");
    expect(provisionalLabel(node("return", "TABELA_PESADA[uf]"))).toBe(
      "Retorno",
    );
    expect(provisionalLabel(node("module", "Módulo"))).toBe("Código solto");
  });

  it("uses the label of a loop, block, folder and file", () => {
    expect(provisionalLabel(node("loop", "for item in itens"))).toBe(
      "for item in itens",
    );
    expect(provisionalLabel(node("block", "with open(p) as f"))).toBe(
      "with open(p) as f",
    );
    expect(provisionalLabel(node("folder", "frete"))).toBe("frete");
    expect(provisionalLabel(node("file", "calculo.py"))).toBe("calculo.py");
  });
});

describe("VID-03: codeLineOf", () => {
  it("shows a call of a function, class or call step", () => {
    expect(codeLineOf(node("function", "calcular_frete"), source)).toBe(
      "calcular_frete()",
    );
    expect(codeLineOf(node("class", "Pedido"), source)).toBe("Pedido()");
    expect(
      codeLineOf(
        node("call", "calcular_frete", { target: "fn:calcular_frete" }),
        source,
      ),
    ).toBe("calcular_frete()");
  });

  it("shows the callee of an external step", () => {
    expect(
      codeLineOf(
        node("external", "requests.get", {
          callee: "requests.get",
          category: "HTTP",
        }),
        source,
      ),
    ).toBe("requests.get()");
  });

  it("shows the condition and the loop header", () => {
    expect(codeLineOf(node("condition", "peso > 30"), source)).toBe(
      "if peso > 30",
    );
    expect(codeLineOf(node("loop", "for item in itens"), source)).toBe(
      "for item in itens",
    );
    expect(codeLineOf(node("block", "with open(p) as f"), source)).toBe(
      "with open(p) as f",
    );
  });

  it("shows the first source line of a return, code or module, trimmed", () => {
    expect(
      codeLineOf(
        node("return", "TABELA_PESADA[uf]", { range: { start: 3, end: 3 } }),
        source,
      ),
    ).toBe("return TABELA_PESADA[uf]");
    expect(
      codeLineOf(
        node("code", "Código", { range: { start: 5, end: 6 } }),
        source,
      ),
    ).toBe("a = 1");
    expect(
      codeLineOf(
        node("module", "Módulo", { range: { start: 1, end: 5 } }),
        source,
      ),
    ).toBe("def calcular_frete(pedido, cep):");
  });

  it("cuts a line longer than 32 characters to 32, ending in …", () => {
    const line = codeLineOf(
      node("return", '{"ok": True, "total": total}', {
        range: { start: 4, end: 4 },
      }),
      source,
    );
    expect(line).toBe('return {"ok": True, "total": to…');
    expect(line).toHaveLength(32);
  });

  it("keeps a line of exactly 32 characters whole", () => {
    expect(
      codeLineOf(
        node("code", "Código", { range: { start: 1, end: 1 } }),
        source,
      ),
    ).toBe("def calcular_frete(pedido, cep):");
  });

  it("skips the docstring and shows the first real code line", () => {
    const src = ['"""Modulo.', "", 'Mais."""', "import os", "x = 1"].join("\n");
    expect(
      codeLineOf(
        node("module", "Módulo", {
          range: { start: 1, end: 5 },
          docstring: { start: 1, end: 3 },
        }),
        src,
      ),
    ).toBe("import os");
  });

  it("falls back to the first line when the node is only a docstring", () => {
    expect(
      codeLineOf(
        node("module", "Módulo", {
          range: { start: 1, end: 1 },
          docstring: { start: 1, end: 1 },
        }),
        '"""So doc."""',
      ),
    ).toBe('"""So doc."""');
  });

  it("shows the path of a folder and of a file", () => {
    expect(codeLineOf(node("folder", "frete", { path: "frete" }), source)).toBe(
      "frete/",
    );
    expect(
      codeLineOf(
        node("file", "calculo.py", { path: "frete/calculo.py" }),
        source,
      ),
    ).toBe("frete/calculo.py");
  });
});

describe("VID-24: isOpenable", () => {
  function graphOf(...nodes: FlowNode[]): Graph {
    return { language: "test", nodes, edges: [], empty: nodes.length === 0 };
  }

  it("follows node.openable on each kind, when the container has a child", () => {
    const opens: NodeKind[] = [
      "folder",
      "file",
      "module",
      "function",
      "class",
      "loop",
      "block",
      "call",
    ];
    const leaves: NodeKind[] = ["code", "condition", "external", "return"];
    for (const kind of opens) {
      const parent = node(kind, "x", { openable: true });
      const child = node("code", "c", { parentId: parent.id });
      expect(isOpenable(parent, graphOf(parent, child))).toBe(true);
    }
    for (const kind of leaves) {
      const leaf = node(kind, "x", { openable: false });
      expect(isOpenable(leaf, graphOf(leaf))).toBe(false);
    }
    const call = node("call", "x", { openable: false });
    expect(isOpenable(call, graphOf(call))).toBe(false);
  });

  it("a container with no child is a leaf, even when the kind opens", () => {
    const empty = node("block", "x", { openable: true });
    expect(isOpenable(empty, graphOf(empty))).toBe(false);
  });

  it("a call opens its target without having a child", () => {
    const call = node("call", "x", { openable: true, target: "fn:f" });
    expect(isOpenable(call, graphOf(call))).toBe(true);
  });
});
