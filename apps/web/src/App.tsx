import type { Explanation, Graph, NodeId } from "@code2n8n/model";
import { useCallback, useMemo, useReducer, useState } from "react";
import { fetchGraph } from "./api";
import { FlowCanvas } from "./flow/FlowCanvas";
import { Breadcrumb } from "./nav/Breadcrumb";
import { initialNav, navReducer } from "./nav/navigation";
import { DetailPanel } from "./panel/DetailPanel";

interface Mapped {
  source: string;
  graph: Graph;
}

/** Paste a snippet, see one level of its map, drill down and read a node's detail. */
export function App() {
  const [text, setText] = useState("");
  const [mapped, setMapped] = useState<Mapped | null>(null);
  const [failed, setFailed] = useState(false);
  const [nav, dispatch] = useReducer(navReducer, initialNav);
  const [explanations, setExplanations] = useState(
    () => new Map<NodeId, Explanation>(),
  );

  async function generate() {
    setFailed(false);
    try {
      const graph = await fetchGraph(text);
      setMapped({ source: text, graph });
      setExplanations(new Map());
      dispatch({ type: "goTo", index: 0 });
    } catch {
      setMapped(null);
      setFailed(true);
    }
  }

  const onExplained = useCallback((id: NodeId, explanation: Explanation) => {
    setExplanations((prev) => new Map(prev).set(id, explanation));
  }, []);

  const suggestionCounts = useMemo(
    () =>
      new Map(
        [...explanations].map(([id, e]) => [id, e.suggestions.length] as const),
      ),
    [explanations],
  );

  const levelId = nav.path.at(-1) ?? null;
  const selected =
    mapped?.graph.nodes.find((n) => n.id === nav.selected) ?? null;

  return (
    <div className="app">
      <header className="input">
        <textarea
          aria-label="Trecho Python"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
        <button type="button" onClick={generate}>
          Gerar mapa
        </button>
      </header>
      <main className="map">
        {failed && <p role="alert">Não foi possível gerar o mapa.</p>}
        {mapped?.graph.empty && <p>Nenhuma função ou instrução encontrada.</p>}
        {mapped && !mapped.graph.empty && (
          <>
            <Breadcrumb
              graph={mapped.graph}
              path={nav.path}
              onGoTo={(index) => dispatch({ type: "goTo", index })}
            />
            <div className="canvas">
              <FlowCanvas
                graph={mapped.graph}
                levelId={levelId}
                suggestionCounts={suggestionCounts}
                onSelect={(id) => dispatch({ type: "select", id })}
                onOpen={(node) => dispatch({ type: "open", node })}
              />
            </div>
          </>
        )}
      </main>
      {mapped && selected && (
        <DetailPanel
          source={mapped.source}
          node={selected}
          effects={[]}
          onExplained={onExplained}
        />
      )}
    </div>
  );
}
