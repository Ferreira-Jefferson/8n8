import {
  type FlowNode,
  fileNodeOf,
  type Graph,
  type HistoryEntry,
  type LanguageInfo,
  type NodeId,
  type ProjectResponse,
  type SettingsResponse,
  type SnippetLanguage,
  type Suggestion,
} from "@8n8/model";
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
  fetchGraph,
  fetchLanguages,
  fetchProject,
  fetchSettings,
} from "./api";
import { codeLineOf } from "./flow/card";
import { FlowCanvas } from "./flow/FlowCanvas";
import { projectLevel } from "./flow/project-level";
import { useTitles } from "./flow/use-titles";
import { HistoryButton } from "./history/HistoryButton";
import { HistoryDrawer } from "./history/HistoryDrawer";
import { Home } from "./home/Home";
import { noFilesText, readsText, snippetFileName } from "./languages";
import { Breadcrumb } from "./nav/Breadcrumb";
import {
  ancestry,
  initialNav,
  type NavAction,
  type NavState,
  navReducer,
  panelNodeOf,
} from "./nav/navigation";
import { DetailPanel, type PanelCache } from "./panel/DetailPanel";
import { externalEffects } from "./panel/effects";
import { IgnoredFiles } from "./panel/IgnoredFiles";
import { clampPanel, PanelResizer } from "./panel/PanelResizer";
import { SettingsButton, SettingsDialog } from "./settings/SettingsDialog";

type Mapped =
  | {
      kind: "snippet";
      source: string;
      graph: Graph;
      /** Absent in a saved map: the history keeps no language. */
      language?: SnippetLanguage | undefined;
    }
  | {
      kind: "project";
      root: string;
      response: ProjectResponse;
      /** Files over 1 MB the person put on the map (CLEAN-06). */
      include: string[];
    };

interface PanelInput {
  source: string;
  origin: ExplainOrigin;
  filePath?: string | undefined;
}

function graphOf(mapped: Mapped): Graph {
  return mapped.kind === "snippet" ? mapped.graph : mapped.response.graph;
}

function originOf(mapped: Mapped): ExplainOrigin {
  if (mapped.kind === "snippet") return { source: mapped.source };
  return mapped.include.length > 0
    ? { root: mapped.root, include: mapped.include }
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

const PANEL_WIDTH_KEY = "8n8.panelWidth";

/** The width the viewer last dragged the panel to; storage may be blocked. */
function savedPanelWidth(): number | undefined {
  try {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return saved > 0 ? clampPanel(saved) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The 8n8 logo (docs/marca/manual.html): two 8s of stacked blocks. The two
 * linked blocks and the edge between them are Petróleo; the other two are
 * the text color at 20%.
 */
function Logo() {
  return (
    <svg
      className="home-logo"
      width="50"
      height="32"
      viewBox="0 0 124 80"
      role="img"
      aria-label="8n8"
    >
      <g fill="none" strokeWidth="6">
        <rect
          x="3"
          y="43"
          width="38"
          height="34"
          rx="6"
          stroke="currentColor"
          strokeOpacity="0.2"
        />
        <rect
          x="83"
          y="3"
          width="38"
          height="34"
          rx="6"
          stroke="currentColor"
          strokeOpacity="0.2"
        />
        <rect x="3" y="3" width="38" height="34" rx="6" stroke="var(--main)" />
        <rect
          x="83"
          y="43"
          width="38"
          height="34"
          rx="6"
          stroke="var(--main)"
        />
        <path
          d="M44 8C66 8 58 72 80 72"
          stroke="var(--main)"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </g>
      <circle cx="44" cy="8" r="5" fill="var(--main)" />
      <circle cx="80" cy="72" r="5" fill="var(--main)" />
    </svg>
  );
}

/** The launcher, the snippet editor, then the map: one level at a time, one click opens, "Voltar" and Esc go back, the panel shows the node (VID-08, 09, 14, 19, 23, 27, 33). */
export interface AppProps {
  /** The folder the CLI asked to open (`#pasta=`); its map opens on load. */
  initialFolder?: string | null;
}

/** A cache with no answer yet, one map per part. */
const emptyPanelCache = (): PanelCache => ({
  summary: new Map(),
  suggestions: new Map(),
});

export function App({ initialFolder = null }: AppProps) {
  const [view, setView] = useState<"home" | "editor" | "map">("home");
  const [text, setText] = useState("");
  const [folder, setFolder] = useState("");
  const [mapped, setMapped] = useState<Mapped | null>(null);
  const [mapVersion, setMapVersion] = useState(0);
  const [failed, setFailed] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [nav, dispatch] = useReducer(appNav, initialNav);
  const [suggestions, setSuggestions] = useState(
    () => new Map<NodeId, Suggestion[]>(),
  );
  const [mark, setMark] = useState<{ line: number; nonce: number }>();
  const [focusId, setFocusId] = useState<NodeId | null>(null);
  const [panelWidth, setPanelWidth] = useState(savedPanelWidth);
  const [historyOpen, setHistoryOpen] = useState(false);
  // The LLM settings; null until they arrive, or if the call fails: the panel then waits for clicks.
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchSettings().then((view) => {
      if (alive) setSettings(view);
    });
    return () => {
      alive = false;
    };
  }, []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const settingsDialog = settingsOpen && (
    <SettingsDialog
      settings={settings}
      onSaved={setSettings}
      onClose={() => setSettingsOpen(false)}
    />
  );
  // The languages the server reads; `[]` until they arrive, or if the call fails.
  const [languages, setLanguages] = useState<LanguageInfo[]>([]);
  useEffect(() => {
    let alive = true;
    fetchLanguages().then((list) => {
      if (alive) setLanguages(list);
    });
    return () => {
      alive = false;
    };
  }, []);
  // Answers already fetched in this map: re-opening a node asks no more.
  const explainCache = useRef<PanelCache>(emptyPanelCache());

  function clearMap() {
    setMapped(null);
    setSuggestions(new Map());
    explainCache.current = emptyPanelCache();
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

  async function generate(source = text) {
    setFailed(false);
    setNotFound(null);
    try {
      const { graph, language } = await fetchGraph(source);
      show({ kind: "snippet", source, graph, language });
    } catch {
      fail(null);
    }
  }

  async function openFolder(path = folder, include: string[] = []) {
    setFailed(false);
    setNotFound(null);
    try {
      const result = await fetchProject(path, include);
      if ("error" in result) fail(result.path);
      else show({ kind: "project", root: path, response: result, include });
    } catch {
      fail(null);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, for the folder the page was opened with
  useEffect(() => {
    if (initialFolder === null) return;
    setFolder(initialFolder);
    openFolder(initialFolder);
  }, []);

  /** A saved map opens by reading its folder or its text again: the history keeps no code (CLEAN-09). */
  function openEntry(entry: HistoryEntry) {
    setHistoryOpen(false);
    if (entry.kind === "project") {
      setFolder(entry.root);
      setView("home");
      openFolder(entry.root);
    } else {
      setText(entry.source);
      setView("editor");
      generate(entry.source);
    }
  }

  /** A snippet map goes back to its text ("Novo código"); a folder map goes back to the launcher ("Início", HOME-03). */
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

  const onSuggestions = useCallback((id: NodeId, list: Suggestion[]) => {
    setSuggestions((prev) => new Map(prev).set(id, list));
  }, []);

  const suggestionCounts = useMemo(
    () =>
      new Map([...suggestions].map(([id, list]) => [id, list.length] as const)),
    [suggestions],
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
              ? noFilesText(languages)
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
            <Logo />
            <SettingsButton onOpen={openSettings} />
          </header>
          <Home
            folder={folder}
            onFolderChange={setFolder}
            onOpenFolder={() => openFolder()}
            onPaste={() => {
              setFailed(false);
              setNotFound(null);
              setView("editor");
            }}
            onOpenEntry={openEntry}
            onShowHistory={() => setHistoryOpen((o) => !o)}
            historyOpen={historyOpen}
            reads={readsText(languages)}
          />
          <div className="home-messages">{messages}</div>
          {drawer}
          {settingsDialog}
        </main>
      );
    }

    return (
      <main className="editor">
        <div className="panel editor-panel">
          <section aria-label="Editor">
            <header className="editor-head">
              <span className="eyebrow">trecho</span>
            </header>
            <textarea
              aria-label="Trecho de código"
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
        <SettingsButton onOpen={openSettings} />
        <div className="editor-actions">
          <button type="button" className="btn" onClick={() => generate()}>
            Gerar mapa
          </button>
          <button type="button" className="btn-ghost" onClick={goHome}>
            Início
          </button>
        </div>
        {drawer}
        {settingsDialog}
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
          {mapped.kind === "project" ? "Início" : "Novo código"}
        </button>
        <HistoryButton
          open={historyOpen}
          onToggle={() => setHistoryOpen((o) => !o)}
        />
        <SettingsButton onOpen={openSettings} />
        {mapped.kind === "project" && (
          <IgnoredFiles
            ignored={mapped.response.ignored}
            onAdd={(path) => openFolder(mapped.root, [...mapped.include, path])}
          />
        )}
        {mapped.kind === "snippet" && mapped.language && (
          <p className="snippet-language">
            {mapped.language.uncertain
              ? `Linguagem incerta. Mostrando como ${mapped.language.label}.`
              : mapped.language.label}
          </p>
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
          suggestions={suggestions}
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
          snippetFile={snippetFileName(
            mapped.kind === "snippet" ? mapped.language : undefined,
            languages,
          )}
          node={panelNode}
          title={titles.get(panelNode.id)}
          effects={externalEffects(graph, panelNode.id)}
          mark={mark}
          auto={
            settings
              ? {
                  summary: settings.autoSummary,
                  suggestions: settings.autoSuggestions,
                }
              : undefined
          }
          onSuggestions={onSuggestions}
          onOpenSettings={openSettings}
          cache={explainCache.current}
        />
      )}
      {settingsDialog}
    </main>
  );
}
