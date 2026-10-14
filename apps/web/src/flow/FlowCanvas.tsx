import type {
  Explanation,
  FlowEdge,
  FlowNode,
  Graph,
  NodeId,
} from "@code2n8n/model";
import {
  ReactFlow,
  useReactFlow,
  useStore,
  ViewportPortal,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  type CSSProperties,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { panelNodeOf } from "../nav/navigation";
import { isOpenable } from "./card";
import { layoutLR, layoutRows, type Position } from "./layout";
import { type Schedule, schedule } from "./motion";
import { projectLevel } from "./project-level";
import { type StepFlowNode, StepNode } from "./StepNode";
import { SuggestionCard } from "./SuggestionCard";
import { highlighted, suggestionCards } from "./suggestion-cards";
import { revealViewport, startViewport } from "./viewport";
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
}

const nodeTypes = { step: StepNode };
const edgeTypes = { wire: WireEdge };

/** The frame grows from the card to the canvas in this time (VID-18). */
export const OPEN_MS = 1100;
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

/** Sets the first view of a level once the canvas has a size (VID-03, 10). */
function StartView({ positions }: { positions: Map<NodeId, Position> }) {
  const { setViewport } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || width === 0 || height === 0) return;
    done.current = true;
    setViewport(startViewport(positions, width, height));
  }, [positions, width, height, setViewport]);
  return null;
}

/**
 * Brings the selected card back into view when the selection changes or the
 * canvas narrows for the panel, at the same zoom (VID-22, 25). The first view
 * of a level stays with `StartView` or `fitView`.
 */
function KeepInView({
  selected,
  positions,
}: {
  selected: NodeId | null;
  positions: Map<NodeId, Position>;
}) {
  const { getViewport, setViewport } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const seen = useRef<{ selected: NodeId | null; width: number } | null>(null);
  useEffect(() => {
    if (width === 0 || height === 0) return;
    const prev = seen.current;
    seen.current = { selected, width };
    if (prev === null) return;
    if (prev.selected === selected && prev.width === width) return;
    const p = selected === null ? undefined : positions.get(selected);
    if (!p) return;
    const next = revealViewport(getViewport(), p, width, height);
    if (next) setViewport(next);
  }, [selected, positions, width, height, getViewport, setViewport]);
  return null;
}

/** Wires drawn by `WireEdge`; `imports` wires get the dashed `edge-imports` class (VID-05, PROJ-03). */
export function toFlowEdges(
  edges: FlowEdge[],
  times: Schedule,
  reduced: boolean,
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
    },
    ...(e.label === undefined ? {} : { label: e.label }),
    ...(e.kind === "imports" ? { className: "edge-imports" } : {}),
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
}: FlowCanvasProps) {
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [frame, setFrame] = useState<Rect | null>(null);
  const expanding = frame !== null;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const { nodes, edges, cards, positions } = useMemo(() => {
    const reduced = prefersReducedMotion();
    const level = projectLevel(graph, levelId);
    const positions = level.rows
      ? layoutRows(level.rows)
      : layoutLR(level.nodes, level.edges, levelId);
    const times = schedule(level.nodes, level.edges, positions, reduced);
    const cards = suggestionCards(level, explanations, levelId, panelNodeOf);
    const lit = highlighted(cards);
    const sources = new Set(level.edges.map((e) => e.source));
    const targets = new Set(level.edges.map((e) => e.target));
    const nodes: StepFlowNode[] = level.nodes.map((n) => ({
      id: n.id,
      type: "step",
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: {
        node: n,
        title: titles.get(n.id),
        isTrigger: level.triggers.has(n.id),
        codeLine: codeLineOf(n),
        hasIn: targets.has(n.id),
        hasOut: sources.has(n.id),
        enterAt: times.enterAt.get(n.id) ?? 0,
        selected: n.id === selected || lit.has(n.id),
        dimmed: cards.length > 0 && !lit.has(n.id),
        suggestionCount: suggestionCounts.get(n.id),
      },
    }));
    return {
      nodes,
      edges: toFlowEdges(level.edges, times, reduced),
      cards,
      positions,
    };
  }, [
    graph,
    levelId,
    selected,
    titles,
    codeLineOf,
    explanations,
    suggestionCounts,
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
        key={`${depth}:${levelId}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={click}
        nodesDraggable={false}
        nodesConnectable={false}
        zoomOnDoubleClick={false}
        minZoom={0.2}
        fitView={focusId !== null}
        {...(focusId === null
          ? {}
          : {
              fitViewOptions: {
                nodes: [{ id: focusId }],
                maxZoom: 1,
                duration: 0,
              },
            })}
        proOptions={{ hideAttribution: true }}
      >
        {focusId === null && <StartView positions={positions} />}
        <KeepInView selected={selected} positions={positions} />
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
