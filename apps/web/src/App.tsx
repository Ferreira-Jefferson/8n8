import {
  type Explanation,
  type FlowNode,
  fileNodeOf,
  type Graph,
  type NodeId,
  type ProjectResponse,
} from "@code2n8n/model";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { type ExplainOrigin, fetchGraph, fetchProject } from "./api";
import { codeLineOf } from "./flow/card";
import { FlowCanvas } from "./flow/FlowCanvas";
import { projectLevel } from "./flow/project-level";
import { useTitles } from "./flow/use-titles";
import { Breadcrumb } from "./nav/Breadcrumb";
import {
  ancestry,
  initialNav,
  type NavAction,
  type NavState,
  navReducer,
  panelNodeOf,
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

function originOf(mapped: Mapped): ExplainOrigin {
  return mapped.kind === "snippet"
    ? { source: mapped.source }
    : { root: mapped.root };
}

/** The code, file and explain origin of a node: the snippet, or the node's file in a project (AD-015). */
function panelInput(mapped: Mapped, node: FlowNode): PanelInput {
  if (mapped.kind === "snippet") {
    return { source: mapped.source, origin: originOf(mapped) };
  }
  const filePath = fileNodeOf(mapped.response.graph, node.id)?.path;
  const file = mapped.response.files.find((f) => f.path === filePath);
  return { source: file?.source ?? "", origin: originOf(mapped), filePath };
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

/** A new map starts at its top level with nothing selected. */
function appNav(state: NavState, action: NavAction | { type: "reset" }) {
  return action.type === "reset" ? initialNav : navReducer(state, action);
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

const SNIPPET_FILE = "trecho.py";

/** The editor, then the map: one level at a time, one click opens, "Voltar" and Esc go back, the panel shows the node (VID-08, 09, 14, 19, 23, 27, 33). */
export function App() {
  const [view, setView] = useState<"editor" | "map">("editor");
  const [text, setText] = useState("");
  const [folder, setFolder] = useState("");
  const [mapped, setMapped] = useState<Mapped | null>(null);
  const [mapVersion, setMapVersion] = useState(0);
  const [failed, setFailed] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [nav, dispatch] = useReducer(appNav, initialNav);
  const [explanations, setExplanations] = useState(
    () => new Map<NodeId, Explanation>(),
  );
  const [mark, setMark] = useState<{ line: number; nonce: number }>();
  const [focusId, setFocusId] = useState<NodeId | null>(null);

  function clearMap() {
    setMapped(null);
    setExplanations(new Map());
    setMark(undefined);
    setFocusId(null);
    dispatch({ type: "reset" });
    setMapVersion((v) => v + 1);
  }

  function show(next: Mapped) {
    clearMap();
    setMapped(next);
    if (!graphOf(next).empty) setView("map");
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

  function newCode() {
    clearMap();
    setView("editor");
  }

  const back = useCallback(() => {
    const left = nav.path.at(-1);
    if (!left) return;
    setFocusId(left.via);
    setMark(undefined);
    dispatch({ type: "back" });
  }, [nav.path]);

  useEffect(() => {
    if (view !== "map") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isEditable(e.target)) back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, back]);

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
  const levelNodes = useMemo(
    () => (graph && !graph.empty ? projectLevel(graph, levelId).nodes : []),
    [graph, levelId],
  );
  const titles = useTitles(
    mapped ? originOf(mapped) : null,
    mapVersion,
    levelNodes,
  );
  const cardCode = useCallback(
    (n: FlowNode) => codeLineOf(n, mapped ? panelInput(mapped, n).source : ""),
    [mapped],
  );

  const byId = (id: NodeId | null) =>
    graph?.nodes.find((n) => n.id === id) ?? null;
  const selected = byId(nav.selected);
  const panelNode = selected ? byId(panelNodeOf(selected)) : null;

  if (view === "editor" || !mapped || !graph) {
    return (
      <main className="editor">
        <div className="panel editor-panel">
          <section aria-label="Editor">
            <header className="editor-head">
              <span className="eyebrow">{SNIPPET_FILE}</span>
            </header>
            <textarea
              aria-label="Trecho Python"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
          </section>
        </div>
        <div className="editor-actions">
          <button type="button" className="btn" onClick={generate}>
            Gerar mapa
          </button>
          <input
            type="text"
            aria-label="Caminho da pasta"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            spellCheck={false}
          />
          <button type="button" className="btn-ghost" onClick={openFolder}>
            Abrir pasta
          </button>
        </div>
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
      </main>
    );
  }

  return (
    <main className={panelNode ? "map with-panel" : "map"}>
      <div className="map-area">
        <button
          type="button"
          className="btn-ghost back"
          disabled={nav.path.length === 0}
          onClick={back}
        >
          Voltar
        </button>
        <Breadcrumb
          graph={graph}
          path={nav.path}
          titles={titles}
          onGoTo={(index) => {
            setFocusId(nav.path[index]?.via ?? null);
            dispatch({ type: "goTo", index });
          }}
        />
        <button type="button" className="btn-ghost new-code" onClick={newCode}>
          Novo código
        </button>
        {mapped.kind === "project" && (
          <IgnoredFiles ignored={mapped.response.ignored} />
        )}
        <FlowCanvas
          graph={graph}
          levelId={levelId}
          depth={nav.path.length}
          selected={nav.selected}
          titles={titles}
          codeLineOf={cardCode}
          explanations={explanations}
          suggestionCounts={suggestionCounts}
          focusId={focusId}
          onSelect={(id) => {
            setMark(undefined);
            dispatch({ type: "select", id });
          }}
          onOpen={(node) => {
            setFocusId(null);
            setMark(undefined);
            dispatch(openAction(graph, node));
          }}
          onSuggestion={(id, line) => {
            setMark((m) => ({ line, nonce: (m?.nonce ?? 0) + 1 }));
            dispatch({ type: "select", id });
          }}
        />
      </div>
      {panelNode && (
        <DetailPanel
          {...panelInput(mapped, panelNode)}
          node={panelNode}
          title={titles.get(panelNode.id)}
          effects={externalEffects(graph, panelNode.id)}
          mark={mark}
          onExplained={onExplained}
        />
      )}
    </main>
  );
}
