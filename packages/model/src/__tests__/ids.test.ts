import { describe, expect, it } from "vitest";
import { childId, fileId, folderId, topLevelId } from "../ids";

describe("topLevelId", () => {
  it("builds a function id from its name", () => {
    expect(topLevelId("function", "calcular_frete", 1)).toBe(
      "fn:calcular_frete",
    );
  });

  it("builds a class id from its name", () => {
    expect(topLevelId("class", "Pedido", 1)).toBe("cls:Pedido");
  });

  it("adds #2 and #3 to the second and third occurrence of the same name", () => {
    expect(topLevelId("function", "a", 2)).toBe("fn:a#2");
    expect(topLevelId("function", "a", 3)).toBe("fn:a#3");
  });

  it("gives no suffix to the first occurrence", () => {
    expect(topLevelId("class", "Pedido", 1)).not.toContain("#");
  });

  it("returns the same id for the same input on repeated calls", () => {
    expect(topLevelId("function", "a", 2)).toBe(topLevelId("function", "a", 2));
    expect(childId("fn:a", "s0")).toBe(childId("fn:a", "s0"));
  });
});

describe("childId", () => {
  it("builds a method id under its class", () => {
    expect(childId("cls:Pedido", "fn:validar")).toBe("cls:Pedido/fn:validar");
  });

  it("builds a step id under its function", () => {
    expect(childId("fn:a", "s0")).toBe("fn:a/s0");
  });

  it("builds a step id inside a branch", () => {
    expect(childId(childId(childId("fn:a", "s2"), "b1"), "s0")).toBe(
      "fn:a/s2/b1/s0",
    );
  });
});

describe("folderId and fileId", () => {
  it("builds folder ids, with dir:. for the root", () => {
    expect(folderId("")).toBe("dir:.");
    expect(folderId("pedidos")).toBe("dir:pedidos");
    expect(folderId("a/b")).toBe("dir:a/b");
  });

  it("builds a file id from its relative path", () => {
    expect(fileId("pedidos/pedidos.py")).toBe("file:pedidos/pedidos.py");
  });

  it("nests internal nodes under the file id with childId", () => {
    expect(
      childId(fileId("pedidos/pedidos.py"), "fn:processar_pedido/s2"),
    ).toBe("file:pedidos/pedidos.py/fn:processar_pedido/s2");
  });
});
