import type { FlowEdge } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { toFlowEdges } from "../FlowCanvas";

describe("toFlowEdges (PROJ-03)", () => {
  it("marks only imports wires with edge-imports and keeps id, ends and label", () => {
    const edges: FlowEdge[] = [
      { id: "i", kind: "imports", source: "dir:pedidos", target: "dir:frete" },
      { id: "c", kind: "calls", source: "fn:a", target: "fn:b" },
      { id: "n", kind: "next", source: "fn:a/s0", target: "fn:a/s1" },
      {
        id: "b",
        kind: "branch",
        source: "fn:a/s1",
        target: "fn:a/s2",
        label: "sim",
      },
    ];
    expect(toFlowEdges(edges)).toEqual([
      {
        id: "i",
        source: "dir:pedidos",
        target: "dir:frete",
        className: "edge-imports",
      },
      { id: "c", source: "fn:a", target: "fn:b" },
      { id: "n", source: "fn:a/s0", target: "fn:a/s1" },
      { id: "b", source: "fn:a/s1", target: "fn:a/s2", label: "sim" },
    ]);
  });
});
