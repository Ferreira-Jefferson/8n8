import type { Graph, NodeId } from "@8n8/model";
import { Fragment } from "react";
import { provisionalLabel } from "../flow/card";
import { useT } from "../i18n";
import type { Opened } from "./navigation";

export interface BreadcrumbProps {
  graph: Graph;
  /** The opened levels, outermost first ("Fluxo principal" or the project name is added in front). */
  path: Opened[];
  /** Reviewed titles by node; a card without one shows its provisional name (VID-14, 15). */
  titles: ReadonlyMap<NodeId, string>;
  /** Index 0 is the first item; index i keeps the first i opened levels. */
  onGoTo: (index: number) => void;
}

/**
 * "Fluxo principal › Calcular frete" or "loja › frete › …": the card clicked
 * for each level; each item goes back to its level (VID-19, CORE-15, PROJ-04).
 * The trail stays on one line: the middle items shrink with "…" first, the
 * last one stays whole, and `title` keeps each full name.
 */
export function Breadcrumb({ graph, path, titles, onGoTo }: BreadcrumbProps) {
  const t = useT();
  const titleOf = (id: NodeId) => {
    const node = graph.nodes.find((n) => n.id === id);
    return titles.get(id) ?? (node ? provisionalLabel(node, t) : id);
  };
  const items = [
    graph.project?.name ?? t("breadcrumb.main"),
    ...path.map((o) => titleOf(o.via)),
  ];
  return (
    <nav aria-label={t("breadcrumb.aria")} className="breadcrumb">
      {items.map((label, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the position is the level
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true"> › </span>}
          <button type="button" title={label} onClick={() => onGoTo(i)}>
            {label}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
