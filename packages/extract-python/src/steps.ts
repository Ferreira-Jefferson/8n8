import {
  childId,
  type EdgeKind,
  type FlowEdge,
  type FlowNode,
  type LineRange,
  type NodeId,
} from "@code2n8n/model";
import type { Node } from "web-tree-sitter";
import { type CallContext, resolveCall } from "./calls";

/** Statements that never become steps and never create the module node. */
export const IGNORED = new Set([
  "comment",
  "import_statement",
  "import_from_statement",
  "future_import_statement",
]);

/** 1-based, inclusive lines of a tree-sitter node. */
export function lineRange(node: Node): LineRange {
  const end = node.endPosition;
  const endsAtLineStart = end.column === 0 && end.row > node.startPosition.row;
  return {
    start: node.startPosition.row + 1,
    end: endsAtLineStart ? end.row : end.row + 1,
  };
}

export interface StepContext {
  call: CallContext;
  /** Node ids of the snippet's functions and classes to their names. */
  names: Map<NodeId, string>;
  /** Output, appended in pre-order. */
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** A wire that leaves a step and waits for the step that follows it. */
interface Pending {
  source: NodeId;
  kind: EdgeKind;
  label?: string;
}

function wire(from: Pending, target: NodeId): FlowEdge {
  const edge: FlowEdge = {
    id: `${from.kind}:${from.source}->${target}`,
    kind: from.kind,
    source: from.source,
    target,
  };
  if (from.label !== undefined) edge.label = from.label;
  return edge;
}

/**
 * Turns a body into steps `<prefix>/s<i>` under `parentId`. Returns the
 * wires still waiting for a following step.
 */
function sequence(
  body: Node[],
  prefix: NodeId,
  parentId: NodeId,
  ctx: StepContext,
): Pending[] {
  let pending: Pending[] = [];
  let index = 0;
  let group: Node[] = [];

  const place = (node: Omit<FlowNode, "id" | "parentId">): NodeId => {
    const id = childId(prefix, `s${index++}`);
    for (const from of pending) ctx.edges.push(wire(from, id));
    const { kind, label, ...rest } = node;
    ctx.nodes.push({ id, kind, label, parentId, ...rest });
    pending = [{ source: id, kind: "next" }];
    return id;
  };

  const flush = () => {
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last) return;
    group = [];
    place({
      kind: "code",
      label: "Código",
      range: { start: lineRange(first).start, end: lineRange(last).end },
      openable: false,
    });
  };

  for (const statement of body) {
    if (IGNORED.has(statement.type)) continue;
    const resolved = resolveCall(statement, ctx.call);
    if (resolved === null) {
      group.push(statement);
      continue;
    }
    flush();
    if (resolved.kind === "call") {
      place({
        kind: "call",
        label: ctx.names.get(resolved.target) ?? resolved.target,
        range: lineRange(statement),
        openable: true,
        target: resolved.target,
      });
    } else {
      place({
        kind: "external",
        label: resolved.callee,
        range: lineRange(statement),
        openable: false,
        callee: resolved.callee,
        category: resolved.category,
      });
    }
  }
  flush();
  return pending;
}

/** Appends the steps of `body` as children of `parentId` (CORE-08, 11-13). */
export function buildSteps(
  body: Node[],
  parentId: NodeId,
  ctx: StepContext,
): void {
  sequence(body, parentId, parentId, ctx);
}
