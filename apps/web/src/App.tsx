import {
  type Explanation,
  type FlowNode,
  fileNodeOf,
  type Graph,
  type NodeId,
  type ProjectResponse,
} from "@code2n8n/model";
import { useCallback, useMemo, useReducer, useState } from "react";
import { type ExplainOrigin, fetchGraph, fetchProject } from "./api";
import { codeLineOf } from "./flow/card";
import { FlowCanvas } from "./flow/FlowCanvas";
import { Breadcrumb } from "./nav/Breadcrumb";
import {
  ancestry,
  initialNav,
  type NavAction,
  navReducer,
} from "./nav/navigation";
import { DetailPanel } from "./panel/DetailPanel";
import { externalEffects } from "./panel/effects";
import { IgnoredFiles } from "./panel/IgnoredFiles";

type Mapped =
  | { kind: "snippet"; source: string; graph: Graph }
  | { kind: "project"; root: string; response: ProjectResponse };

interface PanelInput {
  source: string;
  origin: ExplainOrigin;
  filePath?: string | undefined;
}

function graphOf(mapped: Mapped): Graph {
  return mapped.kind === "snippet" ? mapped.graph : mapped.response.graph;
}

/** The code, file and explain origin of a node: the snippet, or the node's file in a project (AD-015). */
function panelInput(mapped: Mapped, node: FlowNode): PanelInput {
  if (mapped.kind === "snippet") {
    return { source: mapped.source, origin: { source: mapped.source } };
  }
  const filePath = fileNodeOf(mapped.response.graph, node.id)?.path;
  const file = mapped.response.files.find((f) => f.path === filePath);
  return {
    source: file?.source ?? "",
    origin: { root: mapped.root },
    filePath,
  };
}

/** A call into another file of a project jumps to the target's ancestry; anything else stacks (PROJ-04). */
function openAction(graph: Graph, node: FlowNode): NavAction {
  const target = node.kind === "call" ? node.target : undefined;
  if (
    graph.project &&
    target !== undefined &&
    fileNodeOf(graph, target) !== fileNodeOf(graph, node.id)
  ) {
    return { type: "jump", path: ancestry(graph, target), via: node.id };
  }
  return { type: "click", node };
}

/** Paste a snippet or open a local folder, see one level of its map, drill down and read a node's detail. */
export function App() {
  const [text, setText] = useState("");
  const [folder, setFolder] = useState("");
  const [mapped, setMapped] = useState<Mapped | null>(null);
  const [failed, setFailed] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [nav, dispatch] = useReducer(navReducer, initialNav);
  const [explanations, setExplanations] = useState(
    () => new Map<NodeId, Explanation>(),
  );

  function show(next: Mapped) {
    setMapped(next);
    setExplanations(new Map());
    dispatch({ type: "goTo", index: 0 });
  }

  function fail(missing: string | null) {
    setMapped(null);
    setNotFound(missing);
    setFailed(missing === null);
  }

  async function generate() {
    setFailed(false);
    setNotFound(null);
    try {
      const graph = await fetchGraph(text);
      show({ kind: "snippet", source: text, graph });
    } catch {
      fail(null);
    }
  }

  async function openFolder() {
    setFailed(false);
    setNotFound(null);
    try {
      const result = await fetchProject(folder);
      if ("error" in result) fail(result.path);
      else show({ kind: "project", root: folder, response: result });
    } catch {
      fail(null);
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

  const graph = mapped ? graphOf(mapped) : null;
  const levelId = nav.path.at(-1)?.id ?? null;
  const selected = graph?.nodes.find((n) => n.id === nav.selected) ?? null;

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
        <input
          type="text"
          aria-label="Caminho da pasta"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          spellCheck={false}
        />
        <button type="button" onClick={openFolder}>
          Abrir pasta
        </button>
      </header>
      <main className="map">
        {failed && <p role="alert">Não foi possível gerar o mapa.</p>}
        {notFound !== null && (
          <p role="alert">{`Pasta não encontrada: ${notFound}`}</p>
        )}
        {graph?.empty && (
          <p>
            {mapped?.kind === "project"
              ? "Nenhum arquivo .py encontrado na pasta."
              : "Nenhuma função ou instrução encontrada."}
          </p>
        )}
        {graph && !graph.empty && (
          <>
            <Breadcrumb
              graph={graph}
              path={nav.path.map((o) => o.id)}
              onGoTo={(index) => dispatch({ type: "goTo", index })}
            />
            <div className="canvas">
              <FlowCanvas
                graph={graph}
                levelId={levelId}
                depth={nav.path.length}
                selected={nav.selected}
                titles={new Map()}
                codeLineOf={(n) =>
                  codeLineOf(n, mapped ? panelInput(mapped, n).source : "")
                }
                explanations={explanations}
                suggestionCounts={suggestionCounts}
                focusId={null}
                onSelect={(id) => dispatch({ type: "select", id })}
                onOpen={(node) => dispatch(openAction(graph, node))}
                onSuggestion={(id) => dispatch({ type: "select", id })}
              />
            </div>
          </>
        )}
        {mapped?.kind === "project" && (
          <IgnoredFiles ignored={mapped.response.ignored} />
        )}
      </main>
      {mapped && graph && selected && (
        <DetailPanel
          {...panelInput(mapped, selected)}
          node={selected}
          effects={externalEffects(graph, selected.id)}
          onExplained={onExplained}
        />
      )}
    </div>
  );
}
