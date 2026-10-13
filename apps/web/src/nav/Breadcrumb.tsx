import type { Graph, NodeId } from "@code2n8n/model";
import { Fragment } from "react";

export interface BreadcrumbProps {
  graph: Graph;
  /** IDs of the opened levels, outermost first ("Trecho" is added in front). */
  path: NodeId[];
  /** Index 0 is "Trecho"; index i keeps the first i opened levels. */
  onGoTo: (index: number) => void;
}

/** "Trecho › calcular_frete › for item in itens"; each item goes back to its level (CORE-15). */
export function Breadcrumb({ graph, path, onGoTo }: BreadcrumbProps) {
  const labelOf = (id: NodeId) =>
    graph.nodes.find((n) => n.id === id)?.label ?? id;
  const items = ["Trecho", ...path.map(labelOf)];
  return (
    <nav aria-label="Caminho de navegação" className="breadcrumb">
      {items.map((label, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the position is the level
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true"> › </span>}
          <button type="button" onClick={() => onGoTo(i)}>
            {label}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
