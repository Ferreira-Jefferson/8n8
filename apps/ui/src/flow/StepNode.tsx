import type { FlowNode } from "@8n8/model";
import { Handle, type Node, type NodeProps } from "@xyflow/react";
import { plural, useT } from "../i18n";
import { provisionalLabel, tagLabel, tagOf } from "./card";
import { SIDES, type Side } from "./sides";

export interface StepNodeData extends Record<string, unknown> {
  node: FlowNode;
  /** The reviewed title; without it the card shows the provisional name (VID-14, 15). */
  title?: string | undefined;
  /** Entry of the main flow, tagged GATILHO (VID-04). */
  isTrigger: boolean;
  /** The mono line of the card (VID-03). */
  codeLine: string;
  /** The sides where a wire arrives / leaves; the other ports stay hidden (VID-03). */
  portsIn: ReadonlySet<Side>;
  portsOut: ReadonlySet<Side>;
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
  /** How many nodes its level shows, as a number on the card: on the hub and on the cards that open into a sized level. */
  childCount?: number | undefined;
  /** Only on the hub of an inner level: the round button that goes back one level. */
  onBack?: (() => void) | undefined;
}

export type StepFlowNode = Node<StepNodeData, "step">;

/** One card: tag, title with › when it opens, and a code line (VID-03, 04, 15, 22, 26, 32; CORE-06, 23). The hub of an inner level carries the back button. */
export function StepNode({ data }: Pick<NodeProps<StepFlowNode>, "data">) {
  const t = useT();
  const { node, suggestionCount } = data;
  const tag = tagOf(node, data.isTrigger);
  const name = data.title ?? provisionalLabel(node, t);
  const classes = [
    "node",
    data.selected ? "on" : "",
    data.dimmed ? "dim" : "",
    data.isHub ? "hub" : "",
    data.childCount !== undefined ? "has-count" : "",
  ].filter(Boolean);
  const { onBack } = data;
  return (
    <div
      className={classes.join(" ")}
      data-tag={tag}
      data-enter-at={data.enterAt}
      style={{ animationDelay: `${data.enterAt}ms` }}
    >
      {SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="target"
          position={side}
          className={`port port-in port-${side}`}
          style={{ visibility: data.portsIn.has(side) ? "visible" : "hidden" }}
        />
      ))}
      {onBack && (
        <button
          type="button"
          className="hub-back nodrag nopan"
          aria-label={t("step.back")}
          title={t("step.backTitle")}
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
      <span className="tag">{tagLabel(tag, t)}</span>
      <b className="name" title={name}>
        {name}
        {data.openable && !data.isHub && (
          <span className="open-mark" aria-hidden="true">
            ›
          </span>
        )}
      </b>
      <code className="fn">{data.codeLine}</code>
      {data.childCount !== undefined && (
        <span className="hub-count" title={plural(t, "node", data.childCount)}>
          {data.childCount}
        </span>
      )}
      {node.syntaxError && (
        <span className="step-error">
          {t("step.syntaxError", { line: node.syntaxError.line })}
        </span>
      )}
      {suggestionCount ? (
        <span className="step-badge" title={t("step.suggestions")}>
          {suggestionCount}
        </span>
      ) : null}
      {SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={side}
          className={`port port-out port-${side}`}
          style={{
            visibility: data.portsOut.has(side) ? "visible" : "hidden",
          }}
        />
      ))}
    </div>
  );
}
