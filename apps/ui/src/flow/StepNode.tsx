import type { FlowNode } from "@8n8/model";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { provisionalLabel, tagOf } from "./card";

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
  /** A click opens an inner flow, so the card shows the `›` mark (VID-24). */
  openable: boolean;
  /** Milliseconds until the card enters (VID-06). */
  enterAt: number;
  /** Selected or anchoring a suggestion card (VID-22, 32). */
  selected: boolean;
  /** Another node has a suggestion card, and this one is not selected (VID-32). */
  dimmed: boolean;
  suggestionCount?: number | undefined;
  /** The open node, drawn as the parent of its level: it never opens again. */
  isHub?: boolean;
  /** Only on the hub of an inner level: the round button that goes back one level. */
  onBack?: (() => void) | undefined;
}

export type StepFlowNode = Node<StepNodeData, "step">;

/** One card: tag, title with › when it opens, and a code line (VID-03, 04, 15, 22, 26, 32; CORE-06, 23). The hub of an inner level carries the back button. */
export function StepNode({ data }: Pick<NodeProps<StepFlowNode>, "data">) {
  const { node, suggestionCount } = data;
  const tag = tagOf(node, data.isTrigger);
  const name = data.title ?? provisionalLabel(node);
  const classes = [
    "node",
    data.selected ? "on" : "",
    data.dimmed ? "dim" : "",
    data.isHub ? "hub" : "",
  ].filter(Boolean);
  const { onBack } = data;
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
      {onBack && (
        <button
          type="button"
          className="hub-back nodrag nopan"
          aria-label="Nível anterior"
          title="Voltar"
          onClick={(e) => {
            e.stopPropagation();
            onBack();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
          </svg>
        </button>
      )}
      <span className="tag">{tag}</span>
      <b className="name" title={name}>
        {name}
        {data.openable && !data.isHub && (
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
