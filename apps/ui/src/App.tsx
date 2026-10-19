import {
  DEFAULT_LOCALE,
  type FlowNode,
  fileNodeOf,
  type Graph,
  type HistoryEntry,
  type LanguageInfo,
  type NodeId,
  type ProjectSkeleton,
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
  useSyncExternalStore,
} from "react";
import {
  type ExplainOrigin,
  fetchGraph,
  fetchLanguages,
  fetchPick,
  fetchProject,
  fetchProjectFile,
  fetchSearch,
  fetchSettings,
} from "./api";
import { ErrorBoundary } from "./ErrorBoundary";
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
import { createProjectStore, type ProjectStore } from "./project-store";
import { type SearchEntry, searchEntries, searchEntryOf } from "./search/match";
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
      skeleton: ProjectSkeleton;
      /** The skeleton plus the files the viewer opened: its graph is the one the map draws. */
      store: ProjectStore;
      /** Files over 1 MB the person put on the map (CLEAN-06). */
      include: string[];
    };

interface PanelInput {
  /** Absent while the node's file is on its way. */
  source?: string | undefined;
  origin: ExplainOrigin;
  filePath?: string | undefined;
}

/** Whether the map has nothing to draw: asked of the skeleton, which says so before any file loads. */
function emptyOf(mapped: Mapped): boolean {
  return mapped.kind === "snippet"
    ? mapped.graph.empty
    : mapped.skeleton.graph.empty;
}

const EMPTY_GRAPH: Graph = { language: "", empty: true, nodes: [], edges: [] };
const noSubscribe = () => () => {};
const noSources: ReadonlyMap<string, string> = new Map();
const noFailed: ReadonlySet<string> = new Set();

/** The end-to-end tests shrink the loaded-nodes limit with `window.__8n8MaxNodes`; the product never sets it. */
function testLimit(): { maxNodes?: number } {
  const limit = (window as { __8n8MaxNodes?: unknown }).__8n8MaxNodes;
  return typeof limit === "number" && Number.isFinite(limit) && limit > 0
    ? { maxNodes: limit }
    : {};
}

function originOf(mapped: Mapped): ExplainOrigin {
  if (mapped.kind === "snippet") return { source: mapped.source };
  // The version names the build on screen: the server explains that build, not what the disk holds now.
  const version = mapped.skeleton.version;
  return mapped.include.length > 0
    ? { root: mapped.root, include: mapped.include, version }
    : { root: mapped.root, version };
}

/** The code, file and explain origin of a node: the snippet, or the node's file in a project (AD-015). */
function panelInput(
  mapped: Mapped,
  node: FlowNode,
  lookup: Lookup,
): PanelInput {
  if (mapped.kind === "snippet") {
    return { source: mapped.source, origin: originOf(mapped) };
  }
  const filePath = fileNodeOf(lookup.graph, node.id, lookup.byId)?.path;
  const source =
    filePath === undefined ? undefined : lookup.sources.get(filePath);
  return { source, origin: originOf(mapped), filePath };
}

/** What every card asks again on each render: the nodes by id and the source of each file, made once per map. */
interface Lookup {
  graph: Graph;
  byId: ReadonlyMap<NodeId, FlowNode>;
  sources: ReadonlyMap<string, string>;
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
  chat: new Map(),
});

export function App({ initialFolder = null }: AppProps) {
  const [view, setView] = useState<"home" | "editor" | "map">("home");
  const [text, setText] = useState("");
  const [folder, setFolder] = useState("");
  const [mapped, setMapped] = useState<Mapped | null>(null);
  // The map on screen, for a late answer of an older map to check against.
  const mappedRef = useRef<Mapped | null>(null);
  mappedRef.current = mapped;
  const [mapVersion, setMapVersion] = useState(0);
  const [failed, setFailed] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [inDependency, setInDependency] = useState(false);
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
    if (!emptyOf(next)) setView("map");
  }

  function fail(missing: string | null, dependency = false) {
    setMapped(null);
    setNotFound(missing);
    setInDependency(dependency);
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
      if ("error" in result) fail(result.path, result.dependency === true);
      else {
        const store = createProjectStore({
          skeleton: result,
          fetchFile: (file) =>
            fetchProjectFile(path, include, file, result.version),
          ...testLimit(),
          // The folder changed since the skeleton: open it again, with no error shown.
          // A late answer of an older map must not open its folder over the one on screen.
          onStale: () => {
            const now = mappedRef.current;
            if (now?.kind === "project" && now.store === store) {
              openFolder(path, include);
            }
          },
        });
        show({
          kind: "project",
          root: path,
          skeleton: result,
          store,
          include,
        });
      }
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

  const store = mapped?.kind === "project" ? mapped.store : null;
  const storeGraph = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store ? store.getGraph : () => null,
  );
  const sources = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store ? store.getSources : () => noSources,
  );
  const graph = mapped?.kind === "snippet" ? mapped.graph : storeGraph;
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
  const nodesById = useMemo(
    () => new Map(graph?.nodes.map((n) => [n.id, n])),
    [graph],
  );
  // The inside of a project's files comes by file: the open level's, the selected node's, the panel's and the file a selected call reaches.
  const wantedFiles = useMemo(() => {
    if (!graph?.project || !store) return [];
    const selectedNode = nodesById.get(nav.selected ?? "");
    const shownNode = selectedNode && nodesById.get(panelNodeOf(selectedNode));
    const paths = [levelId, nav.selected, shownNode?.id].flatMap((id) => {
      const path = id ? fileNodeOf(graph, id, nodesById)?.path : undefined;
      return path === undefined ? [] : [path];
    });
    const reached = selectedNode && store.refOf(selectedNode.id);
    return [...new Set(reached ? [...paths, reached] : paths)];
  }, [graph, store, nodesById, levelId, nav.selected]);
  const wantedKey = wantedFiles.join("\n");
  // The files of the levels on the way down stay too: going back must not wait for them again.
  const keptFiles = useMemo(() => {
    if (!graph?.project) return [];
    const trail = nav.path.flatMap((step) => {
      const path = fileNodeOf(graph, step.id, nodesById)?.path;
      return path === undefined ? [] : [path];
    });
    return [...new Set([...wantedFiles, ...trail])];
  }, [graph, nodesById, nav.path, wantedFiles]);
  const keptKey = keptFiles.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: keptKey and wantedKey stand for the lists
  useEffect(() => {
    // The store drops the least recent files when it loads: what is on screen is never dropped.
    store?.keep(keptFiles);
    for (const path of wantedFiles) store?.ensureFile(path);
  }, [store, keptKey, wantedKey]);
  const failedFiles = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store ? store.getFailed : () => noFailed,
  );
  // The open level is a file whose nodes have not come yet: the canvas shows its hub and says it loads.
  const levelFile =
    graph?.project && levelId !== null
      ? fileNodeOf(graph, levelId, nodesById)?.path
      : undefined;
  const levelFailed = levelFile !== undefined && failedFiles.has(levelFile);
  const levelLoading =
    levelFile !== undefined && !sources.has(levelFile) && !levelFailed;
  const lookup = useMemo<Lookup>(
    () => ({ graph: graph ?? EMPTY_GRAPH, byId: nodesById, sources }),
    [graph, nodesById, sources],
  );
  const cardCode = useCallback(
    (n: FlowNode) =>
      codeLineOf(n, (mapped && panelInput(mapped, n, lookup).source) ?? ""),
    [mapped, lookup],
  );

  // The search covers the whole graph, not only the open level.
  const entries = useMemo(
    () => (graph ? searchEntries(graph, titles) : []),
    [graph, titles],
  );

  const byId = (id: NodeId | null) =>
    graph?.nodes.find((n) => n.id === id) ?? null;

  // The nodes of files not opened yet come from the server; the file of a hit is the `file` in its ancestry.
  const remoteSearch = useMemo(() => {
    if (mapped?.kind !== "project") return undefined;
    const { root, include, skeleton, store: held } = mapped;
    const files = new Map(
      skeleton.graph.nodes.flatMap((n) =>
        n.kind === "file" && n.path !== undefined ? [[n.id, n.path]] : [],
      ),
    );
    return async (query: string): Promise<SearchEntry[]> => {
      const found = await fetchSearch(root, include, query, skeleton.version);
      if (found.status === "stale") {
        held.reportStale();
        return [];
      }
      return found.hits.map((hit) => {
        const file = hit.ancestry.flatMap((id) => files.get(id) ?? []).at(-1);
        return {
          ...searchEntryOf(hit.node, file, undefined),
          ancestry: hit.ancestry,
        };
      });
    };
  }, [mapped]);

  // The latest navigation, for a pick that waits for a file before it moves.
  const navNow = useRef(nav);
  navNow.current = nav;

  /** A search pick: loads the file of the node if it is not here, opens the levels down to the node, then centers and selects it. */
  async function goToNode(entry: SearchEntry) {
    const { id } = entry;
    let where = graph;
    if (store && !byId(id)) {
      const file = entry.ancestry
        ?.flatMap((a) => nodesById.get(a) ?? [])
        .filter((n) => n.kind === "file")
        .at(-1)?.path;
      if (file === undefined || !(await store.ensureFile(file))) return;
      where = store.getGraph();
    }
    const node = where?.nodes.find((n) => n.id === id);
    if (!where || !node) return;
    const open = navNow.current.path;
    const listed = (path: NodeId[]) =>
      projectLevel(where, path.at(-1) ?? null).nodes.some((n) => n.id === id);
    let path = node.parentId === null ? [] : ancestry(where, node.parentId);
    // A node its parent's level leaves out (a function called, not an entry): open it instead.
    if (!listed(path) && where.nodes.some((n) => n.parentId === id)) {
      path = ancestry(where, id);
    }
    setMark(undefined);
    if (
      path.length === open.length &&
      path.every((p, i) => p === open[i]?.id)
    ) {
      setCenter((c) => ({ id, nonce: (c?.nonce ?? 0) + 1 }));
      dispatch({ type: "select", id });
      return;
    }
    setFocusId(id);
    dispatch({ type: "reveal", path, id });
  }
  /** A call into another file of a project loads that file, then jumps to the target's ancestry; anything else stacks (PROJ-04). */
  async function openNode(node: FlowNode) {
    const file = store?.refOf(node.id);
    if (!store || !graph || node.kind !== "call" || !node.target || !file) {
      dispatch({ type: "click", node });
      return;
    }
    const target = node.target;
    if (!(await store.ensureFile(file))) return;
    dispatch({
      type: "jump",
      path: ancestry(store.getGraph(), target),
      via: node.id,
    });
  }

  const selected = byId(nav.selected);
  const shown = selected ? byId(panelNodeOf(selected)) : null;
  const panelNode = shown && hasPanel(shown) ? shown : null;
  const panelFile =
    store && graph && panelNode
      ? fileNodeOf(graph, panelNode.id, nodesById)?.path
      : undefined;
  const panelRetry =
    panelFile !== undefined && failedFiles.has(panelFile)
      ? () => store?.ensureFile(panelFile)
      : undefined;

  if (view !== "map" || !mapped || !graph) {
    const messages = (
      <>
        {failed && <p role="alert">{t("app.mapFailed")}</p>}
        {notFound !== null && (
          <p role="alert">
            {t(inDependency ? "app.folderDependency" : "app.folderNotFound", {
              path: notFound,
            })}
          </p>
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
        <NodeSearch entries={entries} remote={remoteSearch} onPick={goToNode} />
        {mapped.kind === "project" && (
          <IgnoredFiles
            ignored={mapped.skeleton.ignored}
            onAdd={(path) => openFolder(mapped.root, [...mapped.include, path])}
          />
        )}
        <ErrorBoundary
          resetKey={level}
          fallback={
            <div className="canvas">
              <div className="canvas-loading canvas-error" role="alert">
                <p>{t("flow.drawFailed")}</p>
                {levelId !== null && (
                  <button type="button" className="btn-ghost" onClick={back}>
                    {t("step.backTitle")}
                  </button>
                )}
              </div>
            </div>
          }
        >
          <FlowCanvas
            graph={graph}
            mapKey={mapped}
            loading={levelLoading}
            onRetry={
              levelFailed && levelFile !== undefined
                ? () => store?.ensureFile(levelFile)
                : undefined
            }
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
              openNode(node);
            }}
            onSuggestion={(id, line) => {
              setMark((m) => ({ line, nonce: (m?.nonce ?? 0) + 1 }));
              dispatch({ type: "select", id });
            }}
            onBack={back}
          />
        </ErrorBoundary>
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
              d="M14 6l-6 6 6 6"
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
          {...panelInput(mapped, panelNode, lookup)}
          onRetry={panelRetry}
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
