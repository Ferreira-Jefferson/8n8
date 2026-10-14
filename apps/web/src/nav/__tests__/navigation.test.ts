import type { FlowNode, NodeKind } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { lojaGraph } from "../../flow/__tests__/loja-graph";
import {
  ancestry,
  type NavState,
  navReducer,
  panelNodeOf,
} from "../navigation";

function node(
  id: string,
  kind: NodeKind,
  extra: Partial<FlowNode> = {},
): FlowNode {
  return {
    id,
    kind,
    label: id,
    parentId: null,
    range: { start: 1, end: 1 },
    openable: true,
    ...extra,
  };
}

const empty: NavState = { path: [], selected: null };

describe("navReducer click that opens (VID-23, VID-24)", () => {
  it("pushes a function with itself as via and selects it (CORE-08)", () => {
    const next = navReducer(empty, {
      type: "click",
      node: node("calc", "function"),
    });
    expect(next).toEqual({
      path: [{ id: "calc", via: "calc" }],
      selected: "calc",
    });
  });

  it("pushes the node itself for a loop or block (CORE-10)", () => {
    const s1 = navReducer(empty, {
      type: "click",
      node: node("calc/for1", "loop"),
    });
    expect(s1.path).toEqual([{ id: "calc/for1", via: "calc/for1" }]);
    const s2 = navReducer(empty, {
      type: "click",
      node: node("calc/b1", "block"),
    });
    expect(s2.path).toEqual([{ id: "calc/b1", via: "calc/b1" }]);
  });

  it("pushes the node itself for a module, class, folder and file", () => {
    for (const kind of ["module", "class", "folder", "file"] as const) {
      expect(
        navReducer(empty, { type: "click", node: node("n", kind) }).path,
      ).toEqual([{ id: "n", via: "n" }]);
    }
  });

  it("pushes the target of a call with the step as via, and selects the step (CORE-11)", () => {
    const call = node("main/s2", "call", { target: "helper" });
    const next = navReducer(
      { path: [{ id: "main", via: "main" }], selected: null },
      { type: "click", node: call },
    );
    expect(next).toEqual({
      path: [
        { id: "main", via: "main" },
        { id: "helper", via: "main/s2" },
      ],
      selected: "main/s2",
    });
  });

  it("pushes the same function again for a recursive call", () => {
    const self = node("fn:f/s0", "call", { target: "fn:f" });
    const next = navReducer(
      { path: [{ id: "fn:f", via: "fn:f" }], selected: "fn:f" },
      { type: "click", node: self },
    );
    expect(next.path).toEqual([
      { id: "fn:f", via: "fn:f" },
      { id: "fn:f", via: "fn:f/s0" },
    ]);
  });
});

describe("navReducer click on a leaf (VID-25)", () => {
  it("only selects code, condition, external and return", () => {
    const state: NavState = {
      path: [{ id: "main", via: "main" }],
      selected: "main/s1",
    };
    for (const kind of ["code", "condition", "external", "return"] as const) {
      expect(
        navReducer(state, {
          type: "click",
          node: node("main/s3", kind, { openable: false }),
        }),
      ).toEqual({ path: state.path, selected: "main/s3" });
    }
  });

  it("only selects a call without a target", () => {
    const state: NavState = { path: [], selected: null };
    expect(
      navReducer(state, { type: "click", node: node("m/s0", "call") }),
    ).toEqual({ path: [], selected: "m/s0" });
  });
});

describe("navReducer back (VID-27)", () => {
  it("from 2 levels goes back to 1 and selects the via of the level that left", () => {
    const state: NavState = {
      path: [
        { id: "fn:p", via: "fn:p" },
        { id: "fn:c", via: "fn:p/s3" },
      ],
      selected: "fn:c/s0",
    };
    expect(navReducer(state, { type: "back" })).toEqual({
      path: [{ id: "fn:p", via: "fn:p" }],
      selected: "fn:p/s3",
    });
  });

  it("does nothing on the top level", () => {
    const state: NavState = { path: [], selected: "fn:p" };
    expect(navReducer(state, { type: "back" })).toBe(state);
  });
});

describe("navReducer goTo (CORE-15)", () => {
  const deep: NavState = {
    path: [
      { id: "a", via: "a" },
      { id: "b", via: "a/s1" },
      { id: "c", via: "b/s2" },
    ],
    selected: "c/s1",
  };

  it("goTo(1) cuts a 3-level path to 1 level and selects the via of level 2", () => {
    expect(navReducer(deep, { type: "goTo", index: 1 })).toEqual({
      path: [{ id: "a", via: "a" }],
      selected: "a/s1",
    });
  });

  it("goTo(0) returns to the top level and selects the via of the first level", () => {
    expect(navReducer(deep, { type: "goTo", index: 0 })).toEqual({
      path: [],
      selected: "a",
    });
  });

  it("goTo past the path does nothing", () => {
    expect(navReducer(deep, { type: "goTo", index: 3 })).toBe(deep);
  });
});

describe("navReducer select", () => {
  it("changes only selected", () => {
    const state: NavState = {
      path: [
        { id: "a", via: "a" },
        { id: "b", via: "a/s0" },
      ],
      selected: null,
    };
    expect(navReducer(state, { type: "select", id: "b/s1" })).toEqual({
      path: state.path,
      selected: "b/s1",
    });
  });
});

describe("ancestry (PROJ-04)", () => {
  it("lists the ids from the top level down to the node, inclusive", () => {
    expect(
      ancestry(lojaGraph, "file:frete/calculo.py/fn:calcular_frete"),
    ).toEqual([
      "dir:frete",
      "file:frete/calculo.py",
      "file:frete/calculo.py/fn:calcular_frete",
    ]);
  });

  it("is empty for an absent id", () => {
    expect(ancestry(lojaGraph, "file:nao/existe.py")).toEqual([]);
  });
});

describe("navReducer jump and project nodes (PROJ-04)", () => {
  it("jump builds the path from the ancestry and selects the clicked card", () => {
    const state: NavState = {
      path: [
        { id: "dir:pedidos", via: "dir:pedidos" },
        { id: "file:pedidos/pedidos.py", via: "file:pedidos/pedidos.py" },
      ],
      selected: "file:pedidos/pedidos.py/fn:processar_pedido",
    };
    const target = "file:frete/calculo.py/fn:calcular_frete";
    const via = "file:pedidos/pedidos.py/fn:processar_pedido/s1";
    expect(
      navReducer(state, {
        type: "jump",
        path: ancestry(lojaGraph, target),
        via,
      }),
    ).toEqual({
      path: [
        { id: "dir:frete", via: "dir:frete" },
        { id: "file:frete/calculo.py", via: "file:frete/calculo.py" },
        { id: target, via },
      ],
      selected: via,
    });
  });

  it("click pushes a folder and then a file", () => {
    const s1 = navReducer(empty, {
      type: "click",
      node: node("dir:frete", "folder", { path: "frete" }),
    });
    expect(s1.path).toEqual([{ id: "dir:frete", via: "dir:frete" }]);
    const s2 = navReducer(s1, {
      type: "click",
      node: node("file:frete/calculo.py", "file", { parentId: "dir:frete" }),
    });
    expect(s2.path).toEqual([
      { id: "dir:frete", via: "dir:frete" },
      { id: "file:frete/calculo.py", via: "file:frete/calculo.py" },
    ]);
  });
});

describe("panelNodeOf", () => {
  it("is the target of a call", () => {
    expect(
      panelNodeOf(node("fn:p/s3", "call", { target: "fn:calcular_frete" })),
    ).toBe("fn:calcular_frete");
  });

  it("is the node itself for the other kinds", () => {
    for (const kind of [
      "function",
      "external",
      "code",
      "return",
      "condition",
      "loop",
    ] as const) {
      expect(panelNodeOf(node("x", kind))).toBe("x");
    }
    expect(panelNodeOf(node("m/s0", "call"))).toBe("m/s0");
  });
});
