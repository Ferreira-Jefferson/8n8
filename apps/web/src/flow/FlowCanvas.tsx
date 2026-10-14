import type { FlowEdge, FlowNode, Graph, NodeId } from "@code2n8n/model";
import { type Edge, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { codeLineOf } from "./card";
import { layoutLR } from "./layout";
import { projectLevel } from "./project-level";
import { type StepFlowNode, StepNode } from "./StepNode";

export interface FlowCanvasProps {
  graph: Graph;
  levelId: NodeId | null;
  suggestionCounts: ReadonlyMap<NodeId, number>;
  onSelect: (id: NodeId) => void;
  onOpen: (node: FlowNode) => void;
}

const nodeTypes = { step: StepNode };

/** React Flow wires; `imports` wires get the dashed `edge-imports` class (PROJ-03). */
export function toFlowEdges(edges: FlowEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.label === undefined ? {} : { label: e.label }),
    ...(e.kind === "imports" ? { className: "edge-imports" } : {}),
  }));
}

/** Draws one level of the graph; click selects, double click opens. */
export function FlowCanvas({
  graph,
  levelId,
  suggestionCounts,
  onSelect,
  onOpen,
}: FlowCanvasProps) {
  const { nodes, edges } = useMemo(() => {
    const level = projectLevel(graph, levelId);
    const positions = layoutLR(level.nodes, level.edges);
    const nodes: StepFlowNode[] = level.nodes.map((n) => ({
      id: n.id,
      type: "step",
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: {
        node: n,
        isTrigger: level.triggers.has(n.id),
        codeLine: codeLineOf(n, ""),
        hasIn: true,
        hasOut: true,
        enterAt: 0,
        selected: false,
        dimmed: false,
        suggestionCount: suggestionCounts.get(n.id),
      },
    }));
    return { nodes, edges: toFlowEdges(level.edges) };
  }, [graph, levelId, suggestionCounts]);

  return (
    <ReactFlow
      key={levelId ?? "top"}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => onSelect(n.id)}
      onNodeDoubleClick={(_, n) => onOpen(n.data.node)}
      zoomOnDoubleClick={false}
      fitView
    />
  );
}
