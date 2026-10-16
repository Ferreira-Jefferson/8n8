import type { FlowEdge, FlowNode, Graph, NodeId, Suggestion } from "@8n8/model";
import {
  type NodeChange,
  ReactFlow,
  useReactFlow,
  useStore,
  useUpdateNodeInternals,
  ViewportPortal,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Translate, useT } from "../i18n";
import { panelNodeOf } from "../nav/navigation";
import { isOpenable } from "./card";
import { isDependency, wireSides } from "./dependency";
import { wireLanes } from "./lanes";
import {
  type Bands,
  HUB_FAN,
  hubGridColumns,
  layoutHubGrid,
  layoutLR,
  layoutRows,
  type Position,
  rowBands,
  wrapColumns,
  wrapRows,
} from "./layout";
import { type Schedule, schedule } from "./motion";
import { levelSize, projectLevel, type Reach } from "./project-level";
import { type StepFlowNode, StepNode } from "./StepNode";
import { type BadgeAnchor, SuggestionPopover } from "./SuggestionPopover";
import { FLOW_SIDES, type Side } from "./sides";
import {
  type SuggestionCardModel,
  suggestionCards,
  suggestionsByNode,
} from "./suggestion-cards";
import {
  chooseWrap,
  FIT_PAD,
  fitViewport,
  levelViewport,
  revealViewport,
  WRAP_PAD,
} from "./viewport";
import { WireEdge, type WireFlowEdge, type WireInfo } from "./WireEdge";

export interface FlowCanvasProps {
  graph: Graph;
  /** Who owns the dragged positions: they live as long as this value does. The graph itself changes each time a file loads, so a project passes its map; without it, the graph owns them. */
  mapKey?: unknown;
  /** The open level is a file whose inside is still on its way: only the hub shows, with a loading text. */
  loading?: boolean;
  levelId: NodeId | null;
  /** How many levels are open; with `levelId` it keys the canvas, so a recursion animates again. */
  depth: number;
  selected: NodeId | null;
  /** Reviewed titles by node (VID-14). */
  titles: ReadonlyMap<NodeId, string>;
  /** The card's code line, read from the node's own source (VID-03). */
  codeLineOf: (node: FlowNode) => string;
  /** The suggestions each node got, for the badges (CFG-10). */
  suggestions: ReadonlyMap<NodeId, Suggestion[]>;
  /** The node to center, after "Voltar" or Esc (VID-27). */
  focusId: NodeId | null;
  /** A search pick on this level: the card to center, at the current zoom. */
  centerOn: { id: NodeId; nonce: number } | null;
  /** A click on a leaf (VID-25). */
  onSelect: (id: NodeId) => void;
  /** The "ver detalhes" button of a card: select it and show its panel. */
  onInspect: (id: NodeId) => void;
  /** A click on a node with an inner flow, after the frame grows (VID-18, 23). */
  onOpen: (node: FlowNode) => void;
  /** A click on a suggestion in a badge's balloon (VID-33). */
  onSuggestion: (explainedId: NodeId, line: number) => void;
  /** The round button on the hub of an inner level. */
  onBack: () => void;
}

const nodeTypes = { step: StepNode };
const edgeTypes = { wire: WireEdge };

/** The frame grows from the card to the canvas in this time (VID-18). */
const OPEN_MS = 1100;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

interface Size {
  width: number;
  height: number;
}

const NO_SIZE: Size = { width: 0, height: 0 };

/** Hands the canvas size that React Flow measured for level `level` up to `FlowCanvas`. */
function MeasureCanvas({
  level,
  onSize,
}: {
  level: string;
  onSize: (level: string, size: Size) => void;
}) {
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  useEffect(() => {
    onSize(level, { width, height });
  }, [level, width, height, onSize]);
  return null;
}

/**
 * Measures again every card React Flow holds without a size. A node rebuilt
 * before its first measurement can land after it and erase it; React Flow
 * then hides the card and never measures it again (the blank canvas).
 */
function MeasureCards() {
  const unmeasured = useStore((s) =>
    [...s.nodeLookup.values()]
      .filter(
        (n) => n.measured.width === undefined || !n.internals.handleBounds,
      )
      .map((n) => n.id)
      .join("\n"),
  );
  const update = useUpdateNodeInternals();
  useEffect(() => {
    if (unmeasured !== "") update(unmeasured.split("\n"));
  }, [unmeasured, update]);
  return null;
}

/** The balloon of an open badge, placed on the badge in flow coordinates so it follows a pan or a zoom. */
function Balloon({
  badge,
  cards,
  onSuggestion,
  onClose,
}: {
  badge: HTMLElement;
  cards: readonly SuggestionCardModel[];
  onSuggestion: (explainedId: NodeId, line: number) => void;
  onClose: (byKey: boolean) => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const [anchor] = useState<BadgeAnchor>(() => {
    const r = badge.getBoundingClientRect();
    const top = screenToFlowPosition({ x: r.left + r.width / 2, y: r.top });
    const bottom = screenToFlowPosition({ x: r.left, y: r.bottom });
    return { x: top.x, top: top.y, bottom: bottom.y };
  });
  return (
    <ViewportPortal>
      <SuggestionPopover
        cards={cards}
        anchor={anchor}
        zoom={zoom}
        onSuggestion={onSuggestion}
        onClose={onClose}
      />
    </ViewportPortal>
  );
}

/**
 * Sets the first view of a level once the canvas has a size: the whole level
 * when it is legible, with the `focus` card as near the middle as it can be
 * (VID-03, 10, 27).
 */
function StartView({
  positions,
  size,
  focus,
  padX,
}: {
  positions: Map<NodeId, Position>;
  size: Size;
  focus: NodeId | null;
  padX: number;
}) {
  const { setViewport } = useReactFlow();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || size.width === 0 || size.height === 0) return;
    done.current = true;
    const p = focus === null ? undefined : positions.get(focus);
    setViewport(levelViewport(positions, size.width, size.height, p, padX));
  }, [positions, size, focus, padX, setViewport]);
  return null;
}

/**
 * When the canvas narrows or widens for the panel, shows the whole level
 * again, with the selected card as near the middle as it can be (VID-23, 25).
 * When the selection changes, or the level is too big to show whole, brings
 * the selected card back into view at the same zoom (VID-22, 25). The first
 * view of a level stays with `StartView`.
 */
function KeepInView({
  selected,
  positions,
  size,
  padX,
}: {
  selected: NodeId | null;
  positions: Map<NodeId, Position>;
  size: Size;
  padX: number;
}) {
  const { getViewport, setViewport } = useReactFlow();
  const { width, height } = size;
  const seen = useRef<{ selected: NodeId | null; width: number } | null>(null);
  useEffect(() => {
    if (width === 0 || height === 0) return;
    const prev = seen.current;
    seen.current = { selected, width };
    if (prev === null) return;
    if (prev.selected === selected && prev.width === width) return;
    const p = selected === null ? undefined : positions.get(selected);
    const fit =
      prev.width === width
        ? null
        : fitViewport(positions, width, height, p, padX);
    if (fit) {
      setViewport(fit);
      return;
    }
    if (!p) return;
    const next = revealViewport(getViewport(), p, width, height);
    if (next) setViewport(next);
  }, [selected, positions, width, height, padX, getViewport, setViewport]);
  return null;
}

/** Centers the card of each new `request`, at the current zoom; a request already there at mount is not served. */
function CenterOn({
  request,
  positions,
  size,
}: {
  request: { id: NodeId; nonce: number } | null;
  positions: Map<NodeId, Position>;
  size: Size;
}) {
  const { setCenter, getZoom, getNode } = useReactFlow();
  const handled = useRef(request?.nonce ?? 0);
  useEffect(() => {
    if (!request || request.nonce === handled.current) return;
    const p = positions.get(request.id);
    if (!p || size.width === 0 || size.height === 0) return;
    handled.current = request.nonce;
    const card = getNode(request.id)?.measured;
    setCenter(p.x + (card?.width ?? 0) / 2, p.y + (card?.height ?? 0) / 2, {
      zoom: getZoom(),
      duration: prefersReducedMotion() ? 0 : 300,
    });
  }, [request, positions, size, setCenter, getZoom, getNode]);
  return null;
}

/** Wires drawn by `WireEdge`; the dependency wires (calls, extends, imports) get an `edge-<kind>` class and a `reach-` one, `contains` wires the faint `edge-contains` one (VID-05, PROJ-03). */
export function toFlowEdges(
  edges: FlowEdge[],
  times: Schedule,
  reduced: boolean,
  turnY: ReadonlyMap<string, number> = new Map(),
  lanes: ReadonlyMap<string, number> = new Map(),
  sides: ReadonlyMap<string, readonly [Side, Side]> = new Map(),
  /** The screen-reader name of each wire, in the language of the system; the library's English one without it. */
  t?: Translate,
  /** How far the dependency wires of the level reach: gray inside a file, green across files. */
  reach: Reach = "inside",
  /** The name of each node the wires join, for the hover tag. */
  names: ReadonlyMap<string, string> = new Map(),
): WireFlowEdge[] {
  return edges.map((e) => ({
    id: e.id,
    ...(t
      ? { ariaLabel: t("flow.edgeAria", { from: e.source, to: e.target }) }
      : {}),
    source: e.source,
    target: e.target,
    sourceHandle: (sides.get(e.id) ?? FLOW_SIDES)[0],
    targetHandle: (sides.get(e.id) ?? FLOW_SIDES)[1],
    type: "wire",
    data: {
      drawAt: times.drawAt.get(e.id) ?? 0,
      pulseAt: times.pulseAt.get(e.id) ?? 0,
      reduced,
      ...(turnY.has(e.id) ? { turnY: turnY.get(e.id) } : {}),
      ...(lanes.has(e.id) ? { lane: lanes.get(e.id) } : {}),
      ...(e.labelKey === undefined ? {} : { labelKey: e.labelKey }),
      ...(isDependency(e.kind) ? { dep: true } : {}),
      ...(isDependency(e.kind) && e.source === e.target ? { loop: true } : {}),
      ...(isDependency(e.kind)
        ? {
            info: {
              kind: e.kind as WireInfo["kind"],
              reach:
                reach === "across" && e.label !== undefined
                  ? "language"
                  : reach,
              from: names.get(e.source) ?? e.source,
              to: names.get(e.target) ?? e.target,
            },
          }
        : {}),
    },
    ...(e.label === undefined ? {} : { label: e.label }),
    ...(e.kind === "contains"
      ? { className: "edge-contains" }
      : isDependency(e.kind)
        ? { className: `edge-${e.kind} reach-${reach}` }
        : {}),
  }));
}

/** Draws one level; one click opens a node inside a growing frame or selects a leaf (VID-06, 18, 22, 23, 25, 27, 31, 32). */
export function FlowCanvas({
  graph,
  mapKey = graph,
  loading = false,
  levelId,
  depth,
  selected,
  titles,
  codeLineOf,
  suggestions,
  focusId,
  centerOn,
  onSelect,
  onInspect,
  onOpen,
  onSuggestion,
  onBack,
}: FlowCanvasProps) {
  const t = useT();
  // The library's screen-reader texts, in the language of the system.
  const ariaLabels = useMemo(
    () => ({
      "node.a11yDescription.default": t("flow.nodeHelp"),
      "node.a11yDescription.keyboardDisabled": t("flow.nodeHelpKeyboard"),
      "node.a11yDescription.ariaLiveMessage": ({
        direction,
        x,
        y,
      }: {
        direction: string;
        x: number;
        y: number;
      }) => t("flow.nodeMoved", { direction, x, y }),
      "edge.a11yDescription.default": t("flow.edgeHelp"),
      "handle.ariaLabel": t("flow.handle"),
    }),
    [t],
  );
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [frame, setFrame] = useState<Rect | null>(null);
  // The size is kept per level: a level that just opened waits for its own
  // canvas size before it chooses its rows and its first view.
  const levelKey = `${depth}:${levelId}${loading ? ":loading" : ""}`;
  const [measured, setMeasured] = useState<{ level: string; size: Size }>({
    level: "",
    size: NO_SIZE,
  });
  const onSize = useCallback(
    (level: string, next: Size) =>
      setMeasured((prev) =>
        prev.level === level &&
        prev.size.width === next.width &&
        prev.size.height === next.height
          ? prev
          : { level, size: next },
      ),
    [],
  );
  const size = measured.level === levelKey ? measured.size : NO_SIZE;
  // Cards the viewer dragged, by level, for as long as this graph stays open.
  const [moved, setMoved] = useState<{
    owner: unknown;
    levels: Map<string, Map<NodeId, Position>>;
  }>({ owner: mapKey, levels: new Map() });
  const levelMoved = useMemo(
    () => (moved.owner === mapKey ? moved.levels.get(levelKey) : undefined),
    [moved, mapKey, levelKey],
  );
  const expanding = frame !== null;
  // The card sizes React Flow measured on this level. Each rebuilt node
  // carries its size back: without it React Flow forgets the size, hides the
  // card, and a measurement lost in a race leaves it hidden for good.
  const cardSizes = useRef({ level: "", sizes: new Map<string, Size>() });
  const onNodesChange = useCallback(
    (changes: NodeChange<StepFlowNode>[]) => {
      if (cardSizes.current.level !== levelKey) return;
      const drags = changes.filter(
        (c) => c.type === "position" && c.position !== undefined,
      );
      if (drags.length > 0) {
        setMoved((prev) => {
          const levels = new Map(prev.owner === mapKey ? prev.levels : []);
          const level = new Map(levels.get(levelKey));
          for (const c of drags) {
            if (c.type === "position" && c.position)
              level.set(c.id, c.position);
          }
          levels.set(levelKey, level);
          return { owner: mapKey, levels };
        });
      }
      for (const c of changes) {
        if (c.type === "dimensions" && c.dimensions) {
          cardSizes.current.sizes.set(c.id, c.dimensions);
        }
      }
    },
    [levelKey, mapKey],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // The node whose suggestion balloon is open; one at a time, on this level only.
  const [pop, setPop] = useState<{
    id: NodeId;
    badge: HTMLElement;
    level: string;
  } | null>(null);
  const openPop = pop?.level === levelKey ? pop : null;
  const popId = openPop?.id ?? null;
  const toggleSuggestions = useCallback(
    (id: NodeId, badge: HTMLElement) =>
      setPop((p) =>
        p?.id === id && p.level === levelKey
          ? null
          : { id, badge, level: levelKey },
      ),
    [levelKey],
  );
  // A press anywhere but a balloon or a badge closes the balloon.
  useEffect(() => {
    if (popId === null) return;
    const away = (e: PointerEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest(".suggestion-pop, .step-badge")
      )
        return;
      setPop(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [popId]);

  const { nodes, edges, byNode, positions, padX } = useMemo(() => {
    if (cardSizes.current.level !== levelKey) {
      cardSizes.current = { level: levelKey, sizes: new Map() };
    }
    const sizes = cardSizes.current.sizes;
    const reduced = prefersReducedMotion();
    const level = projectLevel(graph, levelId);
    const hub = level.hub;
    const drawn = hub ? [hub.node, ...level.nodes] : level.nodes;
    // A level too long for the canvas wraps into more rows, so every card
    // shows. The entrance order keeps the unwrapped layout (VID-10, 23).
    const { width, height } = size;
    let order: Map<NodeId, Position>;
    let bands: Bands;
    let gridLanes: Map<string, number> | null = null;
    if (level.rows) {
      const rows = level.rows;
      order = layoutRows(rows);
      const longest = Math.max(0, ...rows.map((r) => r.length));
      const n = chooseWrap(
        longest,
        (k) => layoutRows(wrapRows(rows, k)),
        width,
        height,
      );
      bands = rowBands(wrapRows(rows, n ?? longest));
    } else if (
      hub &&
      level.nodes.length > HUB_FAN &&
      level.edges.every((e) => e.kind === "contains")
    ) {
      // Many children and no wire between them: a grid, not one tall column.
      const cols = hubGridColumns(level.nodes.length, width, height);
      const grid = layoutHubGrid(
        hub.node.id,
        level.nodes.map((n) => n.id),
        cols,
      );
      order = grid.positions;
      bands = { positions: grid.positions, band: new Map(), gapAbove: [0] };
      gridLanes = new Map(
        [...grid.lanes].map(([id, x]) => [`contains:${hub.node.id}->${id}`, x]),
      );
    } else {
      order = layoutLR(
        drawn,
        level.edges.filter((e) => e.source !== e.target),
        levelId,
      );
      const lr = order;
      const columns = new Set([...lr.values()].map((p) => p.x)).size;
      const n = chooseWrap(
        columns,
        (k) => wrapColumns(lr, k).positions,
        width,
        height,
      );
      bands = wrapColumns(lr, n ?? columns);
    }
    const positions = new Map(bands.positions);
    for (const [id, p] of levelMoved ?? []) {
      if (positions.has(id)) positions.set(id, p);
    }
    const times = schedule(drawn, level.edges, order, reduced);
    const turnY = new Map<string, number>();
    for (const e of level.edges) {
      const from = bands.band.get(e.source) ?? 0;
      const to = bands.band.get(e.target) ?? 0;
      const y = bands.gapAbove[to];
      if (!isDependency(e.kind) && to > from && y !== undefined && !levelMoved)
        turnY.set(e.id, y);
    }
    // The wires that keep no right and left: see `wireSides`.
    const sides = wireSides(level.edges, positions, {
      rows: level.rows !== undefined,
      moved: levelMoved ? new Set(levelMoved.keys()) : undefined,
    });
    const lanes =
      gridLanes && !levelMoved
        ? gridLanes
        : wireLanes(
            level.edges.filter(
              (e) => !sides.has(e.id) && e.source !== e.target,
            ),
            positions,
            new Set(turnY.keys()),
          );
    const byNode = suggestionsByNode(
      suggestionCards(level, suggestions, levelId, panelNodeOf),
      hub?.node.id ?? null,
    );
    const portsIn = new Map<NodeId, Set<Side>>();
    const portsOut = new Map<NodeId, Set<Side>>();
    // The ports where a dependency wire starts (filled) or ends (hollow).
    const depIn = new Map<NodeId, Map<Side, Reach>>();
    const depOut = new Map<NodeId, Map<Side, Reach>>();
    const mark = (
      into: Map<NodeId, Map<Side, Reach>>,
      id: NodeId,
      side: Side,
    ) => into.set(id, (into.get(id) ?? new Map()).set(side, level.reach));
    for (const e of level.edges) {
      const [out, into] = sides.get(e.id) ?? FLOW_SIDES;
      portsOut.set(e.source, (portsOut.get(e.source) ?? new Set()).add(out));
      portsIn.set(e.target, (portsIn.get(e.target) ?? new Set()).add(into));
      if (isDependency(e.kind)) {
        mark(depOut, e.source, out);
        mark(depIn, e.target, into);
      }
    }
    const noPorts: ReadonlySet<Side> = new Set();
    const nodes: StepFlowNode[] = drawn.map((n) => {
      const measured = sizes.get(n.id);
      const openable = isOpenable(n, graph);
      return {
        id: n.id,
        type: "step",
        ...(n === hub?.node ? { className: "hub-node" } : {}),
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        ...(measured ? { measured } : {}),
        data: {
          node: n,
          title: titles.get(n.id),
          codeLine: codeLineOf(n),
          openable,
          childCount: openable ? levelSize(graph, n) : undefined,
          portsIn: portsIn.get(n.id) ?? noPorts,
          portsOut: portsOut.get(n.id) ?? noPorts,
          depIn: depIn.get(n.id),
          depOut: depOut.get(n.id),
          enterAt: times.enterAt.get(n.id) ?? 0,
          selected: n.id === selected || n.id === popId,
          suggestionCount: byNode.get(n.id)?.length,
          suggestionsOpen: n.id === popId,
          onSuggestions: (badge: HTMLElement) => toggleSuggestions(n.id, badge),
          onInspect: () => onInspect(n.id),
          ...(n === hub?.node
            ? {
                isHub: true,
                childCount: level.nodes.length,
                onBack: levelId === null ? undefined : onBack,
              }
            : {}),
        },
      };
    });
    return {
      nodes,
      edges: toFlowEdges(
        level.edges,
        times,
        reduced,
        turnY,
        lanes,
        sides,
        t,
        level.reach,
        new Map(graph.nodes.map((n) => [n.id, n.label])),
      ),
      byNode,
      positions,
      padX: bands.gapAbove.length > 1 ? WRAP_PAD : FIT_PAD,
    };
  }, [
    graph,
    levelId,
    levelKey,
    selected,
    titles,
    codeLineOf,
    suggestions,
    popId,
    toggleSuggestions,
    size,
    levelMoved,
    onBack,
    onInspect,
    t,
  ]);

  function open(node: FlowNode, card: Element) {
    if (prefersReducedMotion()) {
      onOpen(node);
      return;
    }
    const c = box.current?.getBoundingClientRect();
    const r = card.getBoundingClientRect();
    setFrame({
      left: r.left - (c?.left ?? 0),
      top: r.top - (c?.top ?? 0),
      width: r.width,
      height: r.height,
    });
    // Two frames: the browser paints the card's rectangle before it grows.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        setFrame(
          (f) =>
            f && {
              left: 0,
              top: 0,
              width: c?.width ?? 0,
              height: c?.height ?? 0,
            },
        ),
      ),
    );
    timer.current = window.setTimeout(() => {
      setFrame(null);
      onOpen(node);
    }, OPEN_MS);
  }

  function click(event: MouseEvent, n: StepFlowNode) {
    if (expanding) return;
    const node = n.data.node;
    // The hub is already open: a click shows its panel, when it has one.
    if (n.data.isHub) {
      if (levelId !== null) onSelect(node.id);
      return;
    }
    if (n.data.openable) open(node, event.currentTarget);
    else onSelect(node.id);
  }

  const popCards = popId === null ? undefined : byNode.get(popId);
  function closePop(byKey: boolean) {
    if (byKey) openPop?.badge.focus();
    setPop(null);
  }

  return (
    <div
      ref={box}
      className={levelId === null ? "canvas" : "canvas level-frame"}
      data-phase={expanding ? "expanding" : "open"}
      data-level={levelId === null ? "top" : "inner"}
    >
      <ReactFlow
        key={levelKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={click}
        nodesDraggable
        nodesConnectable={false}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        ariaLabelConfig={ariaLabels}
      >
        <MeasureCanvas level={levelKey} onSize={onSize} />
        <MeasureCards />
        <StartView
          positions={positions}
          size={size}
          focus={focusId}
          padX={padX}
        />
        <KeepInView
          selected={selected}
          positions={positions}
          size={size}
          padX={padX}
        />
        <CenterOn request={centerOn} positions={positions} size={size} />
        {openPop && popCards && (
          <Balloon
            key={openPop.id}
            badge={openPop.badge}
            cards={popCards}
            onSuggestion={(id, line) => {
              setPop(null);
              onSuggestion(id, line);
            }}
            onClose={closePop}
          />
        )}
      </ReactFlow>
      {loading && (
        <p className="canvas-loading" role="status">
          {t("flow.loading")}
        </p>
      )}
      {frame && (
        <div
          className="open-frame"
          style={{
            left: frame.left,
            top: frame.top,
            width: frame.width,
            height: frame.height,
          }}
        />
      )}
    </div>
  );
}
