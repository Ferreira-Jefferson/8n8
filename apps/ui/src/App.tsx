import {
  DEFAULT_LOCALE,
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
  type ReactNode,
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
  fetchPick,
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
import { I18nProvider, type Translate, translate, useT } from "./i18n";
import { noFilesText, readsText, snippetFileName } from "./languages";
import { Breadcrumb } from "./nav/Breadcrumb";
import {
  ancestry,
  hasPanel,
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
import { searchEntries } from "./search/match";
import { NodeSearch } from "./search/NodeSearch";
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
const PANEL_OPEN_KEY = "8n8.panelOpen";

/** The width the viewer last dragged the panel to; storage may be blocked. */
function savedPanelWidth(): number | undefined {
  try {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return saved > 0 ? clampPanel(saved) : undefined;
  } catch {
    return undefined;
  }
}

/** The panel starts minimized; the viewer's choice to open it stays for the next map. */
function savedPanelCollapsed(): boolean {
  try {
    return localStorage.getItem(PANEL_OPEN_KEY) !== "1";
  } catch {
    return true;
  }
}

/**
 * The 8n8 logo (docs/design/manual-marca.html): two 8s of stacked blocks. The two
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

/** The logo as a button, fixed at the top-left of the map and the editor: it leads back to the launcher (HOME-03). */
function HomeLink({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="logo-link"
      aria-label={t("app.home")}
      onClick={onClick}
    >
      <Logo />
    </button>
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
  // A search pick on the open level: the canvas centers the node (a new nonce each time).
  const [center, setCenter] = useState<{ id: NodeId; nonce: number } | null>(
    null,
  );
  const [panelWidth, setPanelWidth] = useState(savedPanelWidth);
  const [panelCollapsed, setCollapsed] = useState(savedPanelCollapsed);
  const setPanelCollapsed = (collapsed: boolean) => {
    setCollapsed(collapsed);
    try {
      localStorage.setItem(PANEL_OPEN_KEY, collapsed ? "0" : "1");
    } catch {}
  };
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
  // The chosen theme reaches every screen through <html>; "system" leaves the attribute off.
  const theme = settings?.theme;
  useEffect(() => {
    if (!theme || theme === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);
  // The chosen language reaches every component through the provider and the page's `lang`.
  const locale = settings?.locale ?? DEFAULT_LOCALE;
  // App sits above its own provider, so it translates with the locale directly.
  const t: Translate = (key, vars) => translate(locale, key, vars);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const withLocale = (node: ReactNode) => (
    <I18nProvider locale={locale}>{node}</I18nProvider>
  );
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
  // What the LLM wrote is in the old language: a change of language drops it and asks again (the server keeps one cache per language).
  const lastLocale = useRef(locale);
  useEffect(() => {
    if (lastLocale.current === locale) return;
    lastLocale.current = locale;
    explainCache.current = emptyPanelCache();
    setSuggestions(new Map());
    setMapVersion((v) => v + 1);
  }, [locale]);

  function clearMap() {
    setMapped(null);
    setSuggestions(new Map());
    explainCache.current = emptyPanelCache();
    setMark(undefined);
    setFocusId(null);
    setCenter(null);
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

  /** The system chooser; a chosen path fills the field and maps at once. */
  async function pick(kind: "folder" | "file" | "any") {
    try {
      const path = await fetchPick(kind);
      if (path === null) return;
      setFolder(path);
      await openFolder(path);
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

  /** A snippet map goes back to its text ("Novo código"). */
  function newCode() {
    clearMap();
    setView("editor");
  }

  /** The logo on a map leaves it for the launcher, with the folder field kept (HOME-03). */
  function leaveMap() {
    clearMap();
    setView("home");
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

  const select = useCallback((id: NodeId) => {
    setMark(undefined);
    dispatch({ type: "select", id });
  }, []);

  const graph = mapped ? graphOf(mapped) : null;
  const levelId = nav.path.at(-1)?.id ?? null;
  const level = useMemo(
    () => (graph && !graph.empty ? projectLevel(graph, levelId) : null),
    [graph, levelId],
  );
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

  // The search covers the whole graph, not only the open level.
  const entries = useMemo(
    () => (graph ? searchEntries(graph, titles) : []),
    [graph, titles],
  );

  const byId = (id: NodeId | null) =>
    graph?.nodes.find((n) => n.id === id) ?? null;

  /** A search pick: opens the levels down to the node, then centers and selects it. */
  function goToNode(id: NodeId) {
    const node = byId(id);
    if (!graph || !node) return;
    const listed = (path: NodeId[]) =>
      projectLevel(graph, path.at(-1) ?? null).nodes.some((n) => n.id === id);
    let path = node.parentId === null ? [] : ancestry(graph, node.parentId);
    // A node its parent's level leaves out (a function called, not an entry): open it instead.
    if (!listed(path) && graph.nodes.some((n) => n.parentId === id)) {
      path = ancestry(graph, id);
    }
    setMark(undefined);
    if (
      path.length === nav.path.length &&
      path.every((p, i) => p === nav.path[i]?.id)
    ) {
      setCenter((c) => ({ id, nonce: (c?.nonce ?? 0) + 1 }));
      dispatch({ type: "select", id });
      return;
    }
    setFocusId(id);
    dispatch({ type: "reveal", path, id });
  }
  const selected = byId(nav.selected);
  const shown = selected ? byId(panelNodeOf(selected)) : null;
  const panelNode = shown && hasPanel(shown) ? shown : null;

  if (view !== "map" || !mapped || !graph) {
    const messages = (
      <>
        {failed && <p role="alert">{t("app.mapFailed")}</p>}
        {notFound !== null && (
          <p role="alert">{t("app.folderNotFound", { path: notFound })}</p>
        )}
        {graph?.empty && (
          <p>
            {mapped?.kind === "project"
              ? noFilesText(languages, t)
              : t("app.noNodes")}
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
      return withLocale(
        <main className="home">
          <header className="home-bar">
            <Logo />
            <SettingsButton onOpen={openSettings} />
          </header>
          <Home
            folder={folder}
            onFolderChange={setFolder}
            onOpenFolder={() => openFolder()}
            onPick={pick}
            onPaste={() => {
              setFailed(false);
              setNotFound(null);
              setView("editor");
            }}
            onOpenEntry={openEntry}
            onShowHistory={() => setHistoryOpen((o) => !o)}
            historyOpen={historyOpen}
            reads={readsText(languages, t)}
          />
          <div className="home-messages">{messages}</div>
          {drawer}
          {settingsDialog}
        </main>,
      );
    }

    return withLocale(
      <main className="editor">
        <HomeLink onClick={goHome} />
        <div className="panel editor-panel">
          <section aria-label={t("app.editor")}>
            <header className="editor-head">
              <span className="eyebrow">{t("app.snippetEyebrow")}</span>
            </header>
            <textarea
              aria-label={t("app.snippetAria")}
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
            {t("app.generate")}
          </button>
        </div>
        {drawer}
        {settingsDialog}
        {messages}
      </main>,
    );
  }

  return withLocale(
    <main
      className={panelNode && !panelCollapsed ? "map with-panel" : "map"}
      style={
        panelNode && !panelCollapsed && panelWidth !== undefined
          ? { gridTemplateColumns: `1fr auto ${panelWidth}px` }
          : undefined
      }
    >
      <div className="map-area">
        <HomeLink onClick={leaveMap} />
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
        {mapped.kind === "snippet" && (
          <button
            type="button"
            className="btn-ghost new-code"
            onClick={newCode}
          >
            {t("app.newCode")}
          </button>
        )}
        <HistoryButton
          open={historyOpen}
          onToggle={() => setHistoryOpen((o) => !o)}
        />
        <SettingsButton onOpen={openSettings} />
        <NodeSearch entries={entries} onPick={goToNode} />
        {mapped.kind === "project" && (
          <IgnoredFiles
            ignored={mapped.response.ignored}
            onAdd={(path) => openFolder(mapped.root, [...mapped.include, path])}
          />
        )}
        <FlowCanvas
          graph={graph}
          levelId={levelId}
          depth={nav.path.length}
          selected={nav.selected}
          titles={titles}
          codeLineOf={cardCode}
          suggestions={suggestions}
          focusId={focusId}
          centerOn={center}
          onSelect={select}
          onInspect={(id) => {
            select(id);
            setPanelCollapsed(false);
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
      {panelNode && panelCollapsed && (
        <button
          type="button"
          className="btn-ghost panel-toggle"
          aria-label={t("app.expandPanel")}
          aria-expanded={false}
          onClick={() => setPanelCollapsed(false)}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M15 6l-6 6 6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {panelNode && !panelCollapsed && (
        <button
          type="button"
          className="btn-ghost panel-toggle"
          aria-label={t("app.minimizePanel")}
          aria-expanded={true}
          onClick={() => setPanelCollapsed(true)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M7 7l10 10M17 7L7 17"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {panelNode && !panelCollapsed && (
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
      {panelNode && !panelCollapsed && (
        <DetailPanel
          {...panelInput(mapped, panelNode)}
          snippetFile={snippetFileName(
            mapped.kind === "snippet" ? mapped.language : undefined,
            languages,
            t,
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
          claudeMissing={
            settings?.provider === "claude-code" &&
            settings.claude.path === null
          }
          cache={explainCache.current}
        />
      )}
      {settingsDialog}
    </main>,
  );
}
