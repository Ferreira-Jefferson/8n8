import type { FlowNode, NodeKind } from "@code2n8n/model";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";

export interface StepNodeData extends Record<string, unknown> {
  node: FlowNode;
  suggestionCount?: number | undefined;
}

export type StepFlowNode = Node<StepNodeData, "step">;

const ICONS: Record<NodeKind, string> = {
  module: "▤",
  function: "ƒ",
  class: "◆",
  code: "≡",
  call: "↗",
  external: "⇄",
  condition: "◇",
  loop: "↻",
  block: "▢",
  folder: "⊞",
  file: "▭",
};

/** One node of the canvas: kind icon, label, external category and badges (CORE-06, 12, 23). */
export function StepNode({ data }: Pick<NodeProps<StepFlowNode>, "data">) {
  const { node, suggestionCount } = data;
  return (
    <div className={`step-node step-${node.kind}`}>
      <Handle type="target" position={Position.Left} />
      <span className="step-icon" aria-hidden="true">
        {ICONS[node.kind]}
      </span>
      <span className="step-label">{node.label}</span>
      {node.category && <span className="step-category">{node.category}</span>}
      {node.syntaxError && (
        <span className="step-error">
          {`Erro de sintaxe na linha ${node.syntaxError.line}`}
        </span>
      )}
      {suggestionCount ? (
        <span className="step-badge" title="Sugestões">
          {suggestionCount}
        </span>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
