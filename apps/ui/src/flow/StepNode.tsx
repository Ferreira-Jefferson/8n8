import type { FlowNode } from "@8n8/model";
import { Handle, type Node, type NodeProps } from "@xyflow/react";
import { plural, useT } from "../i18n";
import { hasPanel } from "../nav/navigation";
import { provisionalLabel, tagLabel, tagOf } from "./card";
import type { Reach } from "./project-level";
import { SIDES, type Side } from "./sides";

export interface StepNodeData extends Record<string, unknown> {
  node: FlowNode;
  /** The reviewed title; without it the card shows the provisional name (VID-14, 15). */
  title?: string | undefined;
  /** The mono line of the card (VID-03). */
  codeLine: string;
  /** The sides where a wire arrives / leaves; the other ports stay hidden (VID-03). */
  portsIn: ReadonlySet<Side>;
  portsOut: ReadonlySet<Side>;
  /** The ports where a dependency wire ends (a hollow ring) or starts (a filled dot), with how far it reaches: gray inside a file, green across files. */
  depIn?: ReadonlyMap<Side, Reach> | undefined;
  depOut?: ReadonlyMap<Side, Reach> | undefined;
  /** A click opens an inner flow, so the card shows the `›` mark (VID-24). */
  openable: boolean;
  /** Milliseconds until the card enters (VID-06). */
  enterAt: number;
  /** Selected, or its suggestion balloon is open (VID-22). */
  selected: boolean;
  /** How many suggestions the badge shows; no badge without one. */
  suggestionCount?: number | undefined;
  /** The suggestion balloon of this node is open. */
  suggestionsOpen?: boolean | undefined;
  /** A click on the suggestion badge, with the badge, to place the balloon on it. */
  onSuggestions?: ((badge: HTMLElement) => void) | undefined;
  /** A card that opens: the button that shows its panel without entering it. */
  onInspect?: (() => void) | undefined;
  /** The open node, drawn as the parent of its level: it never opens again. */
  isHub?: boolean;
  /** How many nodes its level shows, as a number on the card: on the hub and on the cards that open into a sized level. */
  childCount?: number | undefined;
  /** Only on the hub of an inner level: the round button that goes back one level. */
  onBack?: (() => void) | undefined;
}

export type StepFlowNode = Node<StepNodeData, "step">;

/** The classes of a port where a dependency wire touches: it is a ring at the end and a dot at the start, gray or green by reach. */
function depClass(
  deps: ReadonlyMap<Side, Reach> | undefined,
  side: Side,
): string {
  const reach = deps?.get(side);
  if (!reach) return "";
  // Only a wire inside a file changes the port's color; across files it keeps the green of every port.
  return reach === "inside" ? " port-dep port-inside" : " port-dep";
}

/** One card: tag, title with › when it opens, and a code line (VID-03, 04, 15, 22, 26; CORE-06, 23). The hub of an inner level carries the back button; a node with suggestions, the badge that opens their balloon. */
export function StepNode({ data }: Pick<NodeProps<StepFlowNode>, "data">) {
  const t = useT();
  const { node, suggestionCount } = data;
  const tag = tagOf(node);
  const name = data.title ?? provisionalLabel(node, t);
  const classes = [
    "node",
    data.selected ? "on" : "",
    data.isHub ? "hub" : "",
    data.childCount !== undefined ? "has-count" : "",
  ].filter(Boolean);
  const { onBack, onSuggestions, onInspect } = data;
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
          className={`port port-in port-${side}${depClass(data.depIn, side)}`}
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
      {onInspect && data.openable && !data.isHub && hasPanel(node) && (
        <button
          type="button"
          className="step-inspect nodrag nopan"
          title={t("step.inspectTitle")}
          aria-label={t("step.inspect")}
          onClick={(e) => {
            e.stopPropagation();
            onInspect();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M14 4v16" />
          </svg>
        </button>
      )}
      {suggestionCount ? (
        <button
          type="button"
          className="step-badge nodrag nopan"
          title={plural(t, "suggestion", suggestionCount)}
          aria-label={plural(t, "suggestion", suggestionCount)}
          aria-haspopup="dialog"
          aria-expanded={data.suggestionsOpen ?? false}
          onClick={(e) => {
            e.stopPropagation();
            onSuggestions?.(e.currentTarget);
          }}
        >
          <i className="dot" aria-hidden="true" />
          {suggestionCount}
        </button>
      ) : null}
      {SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={side}
          className={`port port-out port-${side}${depClass(data.depOut, side)}`}
          style={{
            visibility: data.portsOut.has(side) ? "visible" : "hidden",
          }}
        />
      ))}
    </div>
  );
}
