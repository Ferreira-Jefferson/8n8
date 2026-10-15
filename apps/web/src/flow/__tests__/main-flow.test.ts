import type { FlowEdge, FlowNode, Graph, NodeId, NodeKind } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { mainFlowRows } from "../main-flow";
import { videoGraph } from "./video-graph";

function node(
  id: NodeId,
  kind: NodeKind,
  parentId: NodeId | null,
  start: number,
  extra: Partial<FlowNode> = {},
): FlowNode {
  return {
    id,
    kind,
    label: id,
    parentId,
    range: { start, end: start },
    openable: false,
    ...extra,
  };
}

function calls(source: NodeId, target: NodeId): FlowEdge {
  return { id: `calls:${source}->${target}`, kind: "calls", source, target };
}

function graph(nodes: FlowNode[], edges: FlowEdge[] = []): Graph {
  return { language: "python", empty: false, nodes, edges };
}

describe("VID-10: mainFlowRows on the video code", () => {
  it("gives one row: processar_pedido and s0..s6, without the call-free return s7", () => {
    const P = "fn:processar_pedido";
    expect(mainFlowRows(videoGraph)).toEqual([
      {
        trigger: P,
        steps: [0, 1, 2, 3, 4, 5, 6].map((i) => `${P}/s${i}`),
      },
    ]);
  });
});

describe("VID-11: entries", () => {
  it("loose code with a call to a() plus an uncalled b: entries mod and b, in code order", () => {
    const g = graph(
      [
        node("mod", "module", null, 1),
        node("mod/s0", "call", "mod", 1, { target: "fn:a" }),
        node("fn:a", "function", null, 2),
        node("fn:b", "function", null, 4),
      ],
      [calls("mod", "fn:a")],
    );
    expect(mainFlowRows(g)).toEqual([
      { trigger: "mod", steps: ["mod/s0"] },
      { trigger: "fn:b", steps: [] },
    ]);
  });

  it("loose code with only constants is no entry; the two uncalled functions are", () => {
    const g = graph([
      node("mod", "module", null, 1),
      node("mod/s0", "code", "mod", 1, { label: "LIMITE = 30" }),
      node("fn:a", "function", null, 2),
      node("fn:b", "function", null, 4),
    ]);
    expect(mainFlowRows(g).map((r) => r.trigger)).toEqual(["fn:a", "fn:b"]);
  });

  it("two uncalled functions give two rows in code order", () => {
    const g = graph([
      node("fn:b", "function", null, 4),
      node("fn:a", "function", null, 1),
    ]);
    expect(mainFlowRows(g).map((r) => r.trigger)).toEqual(["fn:a", "fn:b"]);
  });

  it("a recursive function with no other caller is an entry", () => {
    const g = graph(
      [
        node("fn:f", "function", null, 1),
        node("fn:f/s0", "call", "fn:f", 2, { target: "fn:f" }),
      ],
      [calls("fn:f", "fn:f")],
    );
    expect(mainFlowRows(g)).toEqual([{ trigger: "fn:f", steps: ["fn:f/s0"] }]);
  });

  it("with only classes, each class is an entry (rule c)", () => {
    const g = graph([
      node("cls:A", "class", null, 1),
      node("cls:A/fn:m", "function", "cls:A", 2),
      node("cls:B", "class", null, 5),
    ]);
    expect(mainFlowRows(g).map((r) => r.trigger)).toEqual(["cls:A", "cls:B"]);
  });

  it("with two functions that call each other, each top definition is an entry (rule c)", () => {
    const g = graph(
      [
        node("fn:a", "function", null, 1),
        node("fn:a/s0", "call", "fn:a", 2, { target: "fn:b" }),
        node("fn:b", "function", null, 3),
        node("fn:b/s0", "call", "fn:b", 4, { target: "fn:a" }),
        node("cls:K", "class", null, 6),
      ],
      [calls("fn:a", "fn:b"), calls("fn:b", "fn:a")],
    );
    expect(mainFlowRows(g)).toEqual([
      { trigger: "fn:a", steps: ["fn:a/s0"] },
      { trigger: "fn:b", steps: ["fn:b/s0"] },
      { trigger: "cls:K", steps: [] },
    ]);
  });

  it("a function called by a method is no entry", () => {
    const g = graph(
      [
        node("fn:a", "function", null, 1),
        node("cls:K", "class", null, 3),
        node("cls:K/fn:m", "function", "cls:K", 4),
        node("fn:b", "function", null, 6),
      ],
      [calls("cls:K/fn:m", "fn:a")],
    );
    expect(mainFlowRows(g).map((r) => r.trigger)).toEqual(["fn:b"]);
  });
});

describe("VID-10: steps of a row", () => {
  it("an entry with no call has a row with only the entry", () => {
    const g = graph([
      node("fn:f", "function", null, 1),
      node("fn:f/s0", "code", "fn:f", 2),
      node("fn:f/s1", "return", "fn:f", 3),
    ]);
    expect(mainFlowRows(g)).toEqual([{ trigger: "fn:f", steps: [] }]);
  });

  it("keeps call, external and return-with-call steps; a loop only with a call inside; never a branch step", () => {
    const g = graph(
      [
        node("fn:f", "function", null, 1),
        node("fn:f/s0", "code", "fn:f", 2),
        node("fn:f/s1", "external", "fn:f", 3, { callee: "print" }),
        node("fn:f/s2", "loop", "fn:f", 4),
        node("fn:f/s2/s0", "external", "fn:f/s2", 5, { callee: "print" }),
        node("fn:f/s3", "loop", "fn:f", 6),
        node("fn:f/s3/s0", "code", "fn:f/s3", 7),
        node("fn:f/s4", "condition", "fn:f", 8),
        node("fn:f/s4/b0/s0", "call", "fn:f", 9, { target: "fn:g" }),
        node("fn:f/s5", "condition", "fn:f", 10),
        node("fn:f/s5/b0/s0", "code", "fn:f", 11),
        node("fn:f/s6", "block", "fn:f", 12),
        node("fn:f/s6/s0", "return", "fn:f/s6", 13, { callee: "open" }),
        node("fn:f/s7", "return", "fn:f", 14, { target: "fn:g" }),
        node("fn:f/s8", "return", "fn:f", 15),
        node("fn:g", "function", null, 20),
      ],
      [calls("fn:f", "fn:g")],
    );
    expect(mainFlowRows(g)).toEqual([
      {
        trigger: "fn:f",
        steps: ["fn:f/s1", "fn:f/s2", "fn:f/s4", "fn:f/s6", "fn:f/s7"],
      },
    ]);
  });

  it("orders the steps by code order", () => {
    const g = graph([
      node("fn:f", "function", null, 1),
      node("fn:f/s1", "external", "fn:f", 3, { callee: "b" }),
      node("fn:f/s0", "external", "fn:f", 2, { callee: "a" }),
    ]);
    expect(mainFlowRows(g)[0]?.steps).toEqual(["fn:f/s0", "fn:f/s1"]);
  });
});

describe("CORE-06: a syntax error outside the entries", () => {
  it("a mod with only a syntax error is no entry but gets its own row", () => {
    const g = graph([
      node("mod", "module", null, 1, { syntaxError: { line: 1 } }),
      node("mod/s0", "code", "mod", 1),
      node("fn:a", "function", null, 3),
    ]);
    expect(mainFlowRows(g)).toEqual([
      { trigger: "mod", steps: [] },
      { trigger: "fn:a", steps: [] },
    ]);
  });
});
