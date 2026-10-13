import type { FlowNode, NodeKind } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { type NavState, navReducer } from "../navigation";

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

describe("navReducer open", () => {
  it("pushes the id of a function (CORE-08)", () => {
    const next = navReducer(empty, {
      type: "open",
      node: node("calc", "function"),
    });
    expect(next.path).toEqual(["calc"]);
  });

  it("pushes the node itself for a loop or block (CORE-10)", () => {
    const s1 = navReducer(empty, {
      type: "open",
      node: node("calc/for1", "loop"),
    });
    expect(s1.path).toEqual(["calc/for1"]);
    const s2 = navReducer(empty, {
      type: "open",
      node: node("calc/b1", "block"),
    });
    expect(s2.path).toEqual(["calc/b1"]);
  });

  it("pushes the target of a call, not the step (CORE-11)", () => {
    const call = node("main/s2", "call", { target: "helper" });
    const next = navReducer(
      { path: ["main"], selected: null },
      { type: "open", node: call },
    );
    expect(next.path).toEqual(["main", "helper"]);
  });

  it("does not change the path for code, external or condition", () => {
    const state: NavState = { path: ["main"], selected: "main/s1" };
    for (const kind of ["code", "external", "condition"] as const) {
      expect(
        navReducer(state, { type: "open", node: node("x", kind) }),
      ).toEqual(state);
    }
  });
});

describe("navReducer goTo (CORE-15)", () => {
  const deep: NavState = { path: ["a", "b", "c"], selected: "c/s1" };

  it("goTo(1) cuts a 3-level path to 1 level and clears the selection", () => {
    expect(navReducer(deep, { type: "goTo", index: 1 })).toEqual({
      path: ["a"],
      selected: null,
    });
  });

  it("goTo(0) returns to the top level", () => {
    expect(navReducer(deep, { type: "goTo", index: 0 })).toEqual({
      path: [],
      selected: null,
    });
  });
});

describe("navReducer select", () => {
  it("changes only selected", () => {
    const state: NavState = { path: ["a", "b"], selected: null };
    expect(navReducer(state, { type: "select", id: "b/s1" })).toEqual({
      path: ["a", "b"],
      selected: "b/s1",
    });
  });
});
