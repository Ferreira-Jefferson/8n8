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

function blockOf(node: Node, field: string): Node[] {
  return node.childForFieldName(field)?.namedChildren ?? [];
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
  incoming: Pending[] = [],
): Pending[] {
  let pending = incoming;
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

  /** `if/elif/else`: one condition, its branches on the same level (CORE-09). */
  const condition = (statement: Node) => {
    const id = place({
      kind: "condition",
      label: statement.childForFieldName("condition")?.text ?? "",
      range: lineRange(statement),
      openable: false,
    });
    const branches: { label: string; body: Node[] }[] = [
      { label: "sim", body: blockOf(statement, "consequence") },
    ];
    let hasElse = false;
    for (const alt of statement.childrenForFieldName("alternative")) {
      if (alt.type === "elif_clause") {
        branches.push({
          label: alt.childForFieldName("condition")?.text ?? "",
          body: blockOf(alt, "consequence"),
        });
      } else {
        hasElse = true;
        branches.push({ label: "não", body: blockOf(alt, "body") });
      }
    }
    const out: Pending[] = [];
    branches.forEach((branch, j) => {
      const incoming: Pending = {
        source: id,
        kind: "branch",
        label: branch.label,
      };
      out.push(
        ...sequence(branch.body, childId(id, `b${j}`), parentId, ctx, [
          incoming,
        ]),
      );
    });
    if (!hasElse) out.push({ source: id, kind: "branch", label: "não" });
    pending = out;
  };

  for (const statement of body) {
    if (IGNORED.has(statement.type)) continue;
    if (statement.type === "if_statement") {
      flush();
      condition(statement);
      continue;
    }
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
