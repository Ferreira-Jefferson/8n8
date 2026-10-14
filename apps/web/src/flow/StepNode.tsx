import type { FlowNode } from "@code2n8n/model";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { isOpenable, provisionalLabel, tagOf } from "./card";

export interface StepNodeData extends Record<string, unknown> {
  node: FlowNode;
  /** The reviewed title; without it the card shows the provisional name (VID-14, 15). */
  title?: string | undefined;
  /** Entry of the main flow, tagged GATILHO (VID-04). */
  isTrigger: boolean;
  /** The mono line of the card (VID-03). */
  codeLine: string;
  /** A wire arrives on the left / leaves on the right (VID-03). */
  hasIn: boolean;
  hasOut: boolean;
  /** Milliseconds until the card enters (VID-06). */
  enterAt: number;
  /** Selected or anchoring a suggestion card (VID-22, 32). */
  selected: boolean;
  /** Another node has a suggestion card, and this one is not selected (VID-32). */
  dimmed: boolean;
  suggestionCount?: number | undefined;
}

export type StepFlowNode = Node<StepNodeData, "step">;

/** One card: tag, title with › when it opens, and a code line (VID-03, 04, 15, 22, 26, 32; CORE-06, 23). */
export function StepNode({ data }: Pick<NodeProps<StepFlowNode>, "data">) {
  const { node, suggestionCount } = data;
  const tag = tagOf(node, data.isTrigger);
  const name = data.title ?? provisionalLabel(node);
  const classes = [
    "node",
    data.selected ? "on" : "",
    data.dimmed ? "dim" : "",
  ].filter(Boolean);
  return (
    <div
      className={classes.join(" ")}
      data-tag={tag}
      data-enter-at={data.enterAt}
      style={{ animationDelay: `${data.enterAt}ms` }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="port port-in"
        style={{ visibility: data.hasIn ? "visible" : "hidden" }}
      />
      <span className="tag">{tag}</span>
      <b className="name" title={name}>
        {name}
        {isOpenable(node) && (
          <span className="open-mark" aria-hidden="true">
            ›
          </span>
        )}
      </b>
      <code className="fn">{data.codeLine}</code>
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
      <Handle
        type="source"
        position={Position.Right}
        className="port port-out"
        style={{ visibility: data.hasOut ? "visible" : "hidden" }}
      />
    </div>
  );
}
