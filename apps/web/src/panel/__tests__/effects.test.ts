import type { FlowNode, Graph } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { externalEffects } from "../effects";
import { pedidoFreteGraph } from "./pedido-frete-graph";

function node(
  id: string,
  kind: FlowNode["kind"],
  parentId: string | null,
  start: number,
  external?: Pick<FlowNode, "callee" | "category">,
): FlowNode {
  return {
    id,
    kind,
    label: external?.callee ?? id,
    parentId,
    range: { start, end: start },
    openable: false,
    ...external,
  };
}

function graphOf(nodes: FlowNode[]): Graph {
  return { language: "python", empty: false, nodes, edges: [] };
}

describe("externalEffects (FID-14)", () => {
  it("lists requests.get on line 5 for calcular_frete in the pedido_frete graph", () => {
    expect(externalEffects(pedidoFreteGraph, "fn:calcular_frete")).toEqual([
      { callee: "requests.get", category: "HTTP", line: 5 },
    ]);
  });

  it("lists nothing for processar_pedido in the pedido_frete graph", () => {
    expect(externalEffects(pedidoFreteGraph, "fn:processar_pedido")).toEqual(
      [],
    );
  });

  it("includes effects nested in a loop and a condition, and excludes other nodes' effects", () => {
    const graph = graphOf([
      node("fn:a", "function", null, 1),
      node("fn:a/s0", "loop", "fn:a", 2),
      node("fn:a/s0/s0", "condition", "fn:a/s0", 3),
      node("fn:a/s0/s0/b0/s0", "external", "fn:a/s0", 4, {
        callee: "requests.post",
        category: "HTTP",
      }),
      node("fn:b", "function", null, 10),
      node("fn:b/s0", "external", "fn:b", 11, {
        callee: "smtplib.SMTP",
        category: "EMAIL",
      }),
    ]);
    expect(externalEffects(graph, "fn:a")).toEqual([
      { callee: "requests.post", category: "HTTP", line: 4 },
    ]);
  });

  it("lists the effects of a class's methods", () => {
    const graph = graphOf([
      node("cls:Loja", "class", null, 4),
      node("cls:Loja/fn:a", "function", "cls:Loja", 5),
      node("cls:Loja/fn:a/s0", "external", "cls:Loja/fn:a", 8, {
        callee: "requests.post",
        category: "HTTP",
      }),
      node("cls:Loja/fn:b", "function", "cls:Loja", 10),
      node("cls:Loja/fn:b/s0", "external", "cls:Loja/fn:b", 11, {
        callee: "open",
        category: "ARQUIVO",
      }),
    ]);
    expect(externalEffects(graph, "cls:Loja")).toEqual([
      { callee: "requests.post", category: "HTTP", line: 8 },
      { callee: "open", category: "ARQUIVO", line: 11 },
    ]);
  });

  it("orders the effects by range.start, not by graph order", () => {
    const graph = graphOf([
      node("fn:a", "function", null, 1),
      node("fn:a/s1", "external", "fn:a", 9, {
        callee: "open",
        category: "ARQUIVO",
      }),
      node("fn:a/s0", "external", "fn:a", 3, {
        callee: "db.execute",
        category: "BANCO",
      }),
    ]);
    expect(externalEffects(graph, "fn:a").map((e) => e.line)).toEqual([3, 9]);
  });
});
