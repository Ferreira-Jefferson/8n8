import {
  type Explanation,
  type FlowNode,
  fileNodeOf,
  type Graph,
  type HistoryEntry,
  type NodeId,
  type ProjectResponse,
} from "@code2n8n/model";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  type ExplainOrigin,
  type ExplainResult,
  fetchGraph,
  fetchProject,
} from "./api";
import { codeLineOf } from "./flow/card";
import { FlowCanvas } from "./flow/FlowCanvas";
import { projectLevel } from "./flow/project-level";
import { useTitles } from "./flow/use-titles";
import { HistoryButton } from "./history/HistoryButton";
import { HistoryDrawer } from "./history/HistoryDrawer";
import { Home } from "./home/Home";
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
import { clampPanel, PanelResizer } from "./panel/PanelResizer";

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
const PANEL_WIDTH_KEY = "code2n8n.panelWidth";

/** The width the viewer last dragged the panel to; storage may be blocked. */
function savedPanelWidth(): number | undefined {
  try {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return saved > 0 ? clampPanel(saved) : undefined;
  } catch {
    return undefined;
  }
}

/** The 8n8 mark: the two linked blocks and the edge between them. */
function BrandMark() {
  return (
    <svg
      className="home-mark"
      width="40"
      height="32"
      viewBox="-8 -8 112 92"
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor">
        <rect x="3" y="3" width="34" height="34" rx="6" strokeWidth="6" />
        <rect x="59" y="39" width="34" height="34" rx="6" strokeWidth="6" />
        <path
          d="M40 8C52 8 44 68 56 68"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </g>
      <circle cx="40" cy="8" r="5" fill="currentColor" />
      <circle cx="56" cy="68" r="5" fill="currentColor" />
    </svg>
  );
}

/** The launcher, the snippet editor, then the map: one level at a time, one click opens, "Voltar" and Esc go back, the panel shows the node (VID-08, 09, 14, 19, 23, 27, 33). */
export function App() {
  const [view, setView] = useState<"home" | "editor" | "map">("home");
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
  const [panelWidth, setPanelWidth] = useState(savedPanelWidth);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Explanations already fetched in this map: re-opening a node asks no more.
  const explainCache = useRef(new Map<NodeId, ExplainResult>());

  function clearMap() {
    setMapped(null);
    setExplanations(new Map());
    explainCache.current = new Map();
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

  /** A saved map opens as a fresh one would, with no call to the parser. */
  function openEntry(entry: HistoryEntry) {
    setFailed(false);
    setNotFound(null);
    setHistoryOpen(false);
    show(entry);
  }

  /** A snippet map goes back to its text; a folder map goes back to the launcher. */
  function newCode() {
    const from = mapped?.kind;
    clearMap();
    setView(from === "project" ? "home" : "editor");
  }

  function goHome() {
    setFailed(false);
    setNotFound(null);
    setView("home");
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
  const level = useMemo(
    () => (graph && !graph.empty ? projectLevel(graph, levelId) : null),
    [graph, levelId],
  );
  const levelNodes = level?.nodes ?? [];
  // The hub of an inner level is a node of the graph: it gets a title too.
  const titled = useMemo(
    () =>
      level?.hub?.inGraph
        ? [level.hub.node, ...level.nodes]
        : (level?.nodes ?? []),
    [level],
  );
  const titles = useTitles(
    mapped ? originOf(mapped) : null,
    mapVersion,
    titled,
  );
  const cardCode = useCallback(
    (n: FlowNode) => codeLineOf(n, mapped ? panelInput(mapped, n).source : ""),
    [mapped],
  );

  const byId = (id: NodeId | null) =>
    graph?.nodes.find((n) => n.id === id) ?? null;
  const selected = byId(nav.selected);
  const panelNode = selected ? byId(panelNodeOf(selected)) : null;

  if (view !== "map" || !mapped || !graph) {
    const messages = (
      <>
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
      </>
    );
    const drawer = historyOpen && (
      <HistoryDrawer
        onClose={() => setHistoryOpen(false)}
        onOpenEntry={openEntry}
      />
    );

    if (view === "home") {
      return (
        <main className="home">
          <header className="home-bar">
            <span className="home-brand">
              <BrandMark />
              8n8
            </span>
          </header>
          <Home
            folder={folder}
            onFolderChange={setFolder}
            onOpenFolder={openFolder}
            onPaste={() => {
              setFailed(false);
              setNotFound(null);
              setView("editor");
            }}
            onOpenEntry={openEntry}
            onShowHistory={() => setHistoryOpen((o) => !o)}
            historyOpen={historyOpen}
          />
          <div className="home-messages">{messages}</div>
          {drawer}
        </main>
      );
    }

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
              wrap="off"
            />
          </section>
        </div>
        <HistoryButton
          open={historyOpen}
          onToggle={() => setHistoryOpen((o) => !o)}
        />
        <div className="editor-actions">
          <button type="button" className="btn" onClick={generate}>
            Gerar mapa
          </button>
          <button type="button" className="btn-ghost" onClick={goHome}>
            Início
          </button>
        </div>
        {drawer}
        {messages}
      </main>
    );
  }

  return (
    <main
      className={panelNode ? "map with-panel" : "map"}
      style={
        panelNode && panelWidth !== undefined
          ? { gridTemplateColumns: `1fr auto ${panelWidth}px` }
          : undefined
      }
    >
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
            // The last item is the open level: it shows that node's code.
            if (index === nav.path.length && levelId !== null) {
              setMark(undefined);
              dispatch({ type: "select", id: levelId });
              return;
            }
            setFocusId(nav.path[index]?.via ?? null);
            dispatch({ type: "goTo", index });
          }}
        />
        <button type="button" className="btn-ghost new-code" onClick={newCode}>
          Novo código
        </button>
        <HistoryButton
          open={historyOpen}
          onToggle={() => setHistoryOpen((o) => !o)}
        />
        {mapped.kind === "project" && (
          <IgnoredFiles ignored={mapped.response.ignored} />
        )}
        <span className="node-count">
          {levelNodes.length === 1 ? "1 nó" : `${levelNodes.length} nós`}
        </span>
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
          onBack={back}
        />
      </div>
      {historyOpen && (
        <HistoryDrawer
          onClose={() => setHistoryOpen(false)}
          onOpenEntry={openEntry}
        />
      )}
      {panelNode && (
        <PanelResizer
          width={panelWidth}
          onResize={(width) => {
            setPanelWidth(width);
            try {
              localStorage.setItem(PANEL_WIDTH_KEY, String(width));
            } catch {}
          }}
        />
      )}
      {panelNode && (
        <DetailPanel
          {...panelInput(mapped, panelNode)}
          node={panelNode}
          title={titles.get(panelNode.id)}
          effects={externalEffects(graph, panelNode.id)}
          mark={mark}
          onExplained={onExplained}
          cache={explainCache.current}
        />
      )}
    </main>
  );
}
