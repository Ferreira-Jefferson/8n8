import type {
  Explanation,
  FlowEdge,
  FlowNode,
  Graph,
  NodeId,
} from "@code2n8n/model";
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
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { panelNodeOf } from "../nav/navigation";
import { isOpenable } from "./card";
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
import { projectLevel } from "./project-level";
import { type StepFlowNode, StepNode } from "./StepNode";
import { SuggestionCard } from "./SuggestionCard";
import { highlighted, suggestionCards } from "./suggestion-cards";
import {
  chooseWrap,
  FIT_PAD,
  fitViewport,
  levelViewport,
  revealViewport,
  WRAP_PAD,
} from "./viewport";
import { WireEdge, type WireFlowEdge } from "./WireEdge";

export interface FlowCanvasProps {
  graph: Graph;
  levelId: NodeId | null;
  /** How many levels are open; with `levelId` it keys the canvas, so a recursion animates again. */
  depth: number;
  selected: NodeId | null;
  /** Reviewed titles by node (VID-14). */
  titles: ReadonlyMap<NodeId, string>;
  /** The card's code line, read from the node's own source (VID-03). */
  codeLineOf: (node: FlowNode) => string;
  explanations: ReadonlyMap<NodeId, Explanation>;
  suggestionCounts: ReadonlyMap<NodeId, number>;
  /** The node to center, after "Voltar" or Esc (VID-27). */
  focusId: NodeId | null;
  /** A click on a leaf (VID-25). */
  onSelect: (id: NodeId) => void;
  /** A click on a node with an inner flow, after the frame grows (VID-18, 23). */
  onOpen: (node: FlowNode) => void;
  /** A click on a suggestion card (VID-33). */
  onSuggestion: (explainedId: NodeId, line: number) => void;
  /** The round button on the hub of an inner level. */
  onBack: () => void;
}

const nodeTypes = { step: StepNode };
const edgeTypes = { wire: WireEdge };

/** The frame grows from the card to the canvas in this time (VID-18). */
const OPEN_MS = 1100;
const CARD_LIFT = 64;
const CARD_INDENT = 20;

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

/** Wires drawn by `WireEdge`; `imports` wires get the dashed `edge-imports` class (VID-05, PROJ-03), `contains` wires the faint `edge-contains` one. */
export function toFlowEdges(
  edges: FlowEdge[],
  times: Schedule,
  reduced: boolean,
  turnY: ReadonlyMap<string, number> = new Map(),
  lanes: ReadonlyMap<string, number> = new Map(),
): WireFlowEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "wire",
    data: {
      drawAt: times.drawAt.get(e.id) ?? 0,
      pulseAt: times.pulseAt.get(e.id) ?? 0,
      reduced,
      ...(turnY.has(e.id) ? { turnY: turnY.get(e.id) } : {}),
      ...(lanes.has(e.id) ? { lane: lanes.get(e.id) } : {}),
    },
    ...(e.label === undefined ? {} : { label: e.label }),
    ...(e.kind === "imports" || e.kind === "contains"
      ? { className: `edge-${e.kind}` }
      : {}),
  }));
}

/** Draws one level; one click opens a node inside a growing frame or selects a leaf (VID-06, 18, 22, 23, 25, 27, 31, 32). */
export function FlowCanvas({
  graph,
  levelId,
  depth,
  selected,
  titles,
  codeLineOf,
  explanations,
  suggestionCounts,
  focusId,
  onSelect,
  onOpen,
  onSuggestion,
  onBack,
}: FlowCanvasProps) {
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [frame, setFrame] = useState<Rect | null>(null);
  // The size is kept per level: a level that just opened waits for its own
  // canvas size before it chooses its rows and its first view.
  const levelKey = `${depth}:${levelId}`;
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
    graph: Graph;
    levels: Map<string, Map<NodeId, Position>>;
  }>({ graph, levels: new Map() });
  const levelMoved = useMemo(
    () => (moved.graph === graph ? moved.levels.get(levelKey) : undefined),
    [moved, graph, levelKey],
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
          const levels = new Map(prev.graph === graph ? prev.levels : []);
          const level = new Map(levels.get(levelKey));
          for (const c of drags) {
            if (c.type === "position" && c.position)
              level.set(c.id, c.position);
          }
          levels.set(levelKey, level);
          return { graph, levels };
        });
      }
      for (const c of changes) {
        if (c.type === "dimensions" && c.dimensions) {
          cardSizes.current.sizes.set(c.id, c.dimensions);
        }
      }
    },
    [levelKey, graph],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const { nodes, edges, cards, positions, padX } = useMemo(() => {
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
      order = layoutLR(drawn, level.edges, levelId);
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
      if (to > from && y !== undefined && !levelMoved) turnY.set(e.id, y);
    }
    const lanes =
      gridLanes && !levelMoved
        ? gridLanes
        : wireLanes(level.edges, positions, new Set(turnY.keys()));
    const cards = suggestionCards(level, explanations, levelId, panelNodeOf);
    const lit = highlighted(cards);
    const sources = new Set(level.edges.map((e) => e.source));
    const targets = new Set(level.edges.map((e) => e.target));
    const nodes: StepFlowNode[] = drawn.map((n) => {
      const measured = sizes.get(n.id);
      return {
        id: n.id,
        type: "step",
        ...(n === hub?.node ? { className: "hub-node" } : {}),
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        ...(measured ? { measured } : {}),
        data: {
          node: n,
          title: titles.get(n.id),
          isTrigger: level.triggers.has(n.id),
          codeLine: codeLineOf(n),
          hasIn: targets.has(n.id),
          hasOut: sources.has(n.id),
          enterAt: times.enterAt.get(n.id) ?? 0,
          selected: n.id === selected || lit.has(n.id),
          dimmed: cards.length > 0 && !lit.has(n.id) && n.id !== selected,
          suggestionCount: suggestionCounts.get(n.id),
          ...(n === hub?.node
            ? { isHub: true, onBack: levelId === null ? undefined : onBack }
            : {}),
        },
      };
    });
    return {
      nodes,
      edges: toFlowEdges(level.edges, times, reduced, turnY, lanes),
      cards,
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
    explanations,
    suggestionCounts,
    size,
    levelMoved,
    onBack,
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
    if (isOpenable(node)) open(node, event.currentTarget);
    else onSelect(node.id);
  }

  const perAnchor = new Map<NodeId, number>();
  const anchored = cards.flatMap((card) => {
    if (card.anchorId === null) return [];
    const k = perAnchor.get(card.anchorId) ?? 0;
    perAnchor.set(card.anchorId, k + 1);
    const p = positions.get(card.anchorId) ?? { x: 0, y: 0 };
    const style: CSSProperties = {
      position: "absolute",
      pointerEvents: "all",
      transform: `translate(${p.x + CARD_INDENT}px, ${p.y - CARD_LIFT - k * CARD_LIFT}px)`,
    };
    return [{ card, style }];
  });
  const framed = cards.filter((c) => c.anchorId === null);

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
        zoomOnDoubleClick={false}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
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
        <ViewportPortal>
          {anchored.map(({ card, style }) => (
            <SuggestionCard
              key={card.key}
              card={card}
              onSuggestion={onSuggestion}
              style={style}
            />
          ))}
        </ViewportPortal>
      </ReactFlow>
      {framed.length > 0 && (
        <div className="frame-cards">
          {framed.map((card) => (
            <SuggestionCard
              key={card.key}
              card={card}
              onSuggestion={onSuggestion}
            />
          ))}
        </div>
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
