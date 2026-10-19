import { lineRange } from "@8n8/lang-treesitter";
import {
  childId,
  type EdgeKind,
  type EdgeLabelKey,
  type FlowEdge,
  type FlowNode,
  type NodeId,
} from "@8n8/model";
import type { Node } from "web-tree-sitter";
import { type CallContext, deferredTargets, resolveCall } from "./calls";
import { isRequireDeclaration } from "./imports";

/**
 * Statements that never become steps and never create the module node:
 * comments, imports, type-only declarations and jumps. ERROR nodes are left
 * to `markSyntaxErrors`, which marks the nearest node.
 */
const IGNORED = new Set([
  "comment",
  "import_statement",
  "interface_declaration",
  "type_alias_declaration",
  "ambient_declaration",
  "function_signature",
  "abstract_method_signature",
  "method_signature",
  "index_signature",
  "decorator",
  "break_statement",
  "continue_statement",
  "empty_statement",
  "ERROR",
]);

/** True for a node that is not a step: see `IGNORED`; `export { a }`; `require` imports. */
export function isIgnored(node: Node): boolean {
  if (IGNORED.has(node.type)) return true;
  if (node.type === "export_statement") {
    const declaration = node.childForFieldName("declaration");
    if (declaration) return isIgnored(declaration);
    return node.childForFieldName("value") === null;
  }
  return isRequireDeclaration(node);
}

/** Labels are one line: a header that spans lines is joined by single spaces. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface StepContext {
  call: CallContext;
  /** Node ids of the snippet's functions and classes to their names. */
  names: Map<NodeId, string>;
  /** Output, appended in pre-order. */
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** `Node.id` of an arrow function's expression body, which is its implicit `return`. */
  implicitReturn?: number;
}

/** A wire that leaves a step and waits for the step that follows it. */
interface Pending {
  source: NodeId;
  kind: EdgeKind;
  label?: string;
  labelKey?: EdgeLabelKey;
}

function wire(from: Pending, target: NodeId): FlowEdge {
  const edge: FlowEdge = {
    id: `${from.kind}:${from.source}->${target}`,
    kind: from.kind,
    source: from.source,
    target,
  };
  if (from.label !== undefined) edge.label = from.label;
  if (from.labelKey !== undefined) edge.labelKey = from.labelKey;
  return edge;
}

const LOOPS = new Set([
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
]);

/** Bare `{ ... }` blocks are not steps: their statements join the sequence. */
function expand(nodes: Node[]): Node[] {
  return nodes.flatMap((n) =>
    n.type === "statement_block" ? expand(n.namedChildren) : [n],
  );
}

/** The statements of a block, or of a single statement used as a body. */
export function blockOf(node: Node | null): Node[] {
  if (node === null) return [];
  return expand(node.type === "statement_block" ? node.namedChildren : [node]);
}

/** `(a && b)` → `a && b`. */
function conditionText(node: Node | null): string {
  if (node === null) return "";
  const inner =
    node.type === "parenthesized_expression"
      ? node.text.slice(1, -1)
      : node.text;
  return oneLine(inner);
}

/** The tokens before the loop's body, e.g. `for (const item of itens)`. */
function loopHeader(statement: Node): string {
  if (statement.type === "do_statement") {
    return oneLine(
      `do while ${statement.childForFieldName("condition")?.text ?? ""}`,
    );
  }
  const body = statement.childForFieldName("body");
  if (!body) return oneLine(statement.text);
  return oneLine(
    statement.text.slice(0, body.startIndex - statement.startIndex),
  );
}

/** The statements of a `try`: its body, its `catch` and its `finally`. */
function tryStatements(statement: Node): Node[] {
  return [
    ...blockOf(statement.childForFieldName("body")),
    ...blockOf(
      statement.childForFieldName("handler")?.childForFieldName("body") ?? null,
    ),
    ...blockOf(
      statement.childForFieldName("finalizer")?.childForFieldName("body") ??
        null,
    ),
  ];
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

  /** Walks the branches of a condition; each one starts with a `branch` wire. */
  const branchesOf = (
    id: NodeId,
    branches: { label: string; labelKey?: EdgeLabelKey; body: Node[] }[],
    fallthrough: { label: string; labelKey: EdgeLabelKey } | null,
  ) => {
    const out: Pending[] = [];
    branches.forEach((branch, j) => {
      const first: Pending = {
        source: id,
        kind: "branch",
        label: branch.label,
        ...(branch.labelKey ? { labelKey: branch.labelKey } : {}),
      };
      out.push(
        ...sequence(branch.body, childId(id, `b${j}`), parentId, ctx, [first]),
      );
    });
    if (fallthrough !== null) {
      out.push({ source: id, kind: "branch", ...fallthrough });
    }
    pending = out;
  };

  /** `if / else if / else`: one condition, its branches on the same level. */
  const condition = (statement: Node) => {
    const id = place({
      kind: "condition",
      label: conditionText(statement.childForFieldName("condition")),
      range: lineRange(statement),
      openable: false,
    });
    const branches: {
      label: string;
      labelKey?: EdgeLabelKey;
      body: Node[];
    }[] = [
      {
        label: "true",
        labelKey: "true",
        body: blockOf(statement.childForFieldName("consequence")),
      },
    ];
    let hasElse = false;
    let alt = statement.childForFieldName("alternative");
    while (alt) {
      const inner = alt.namedChildren.find((c) => c.type !== "comment") ?? null;
      if (inner?.type === "if_statement") {
        branches.push({
          label: conditionText(inner.childForFieldName("condition")),
          body: blockOf(inner.childForFieldName("consequence")),
        });
        alt = inner.childForFieldName("alternative");
      } else {
        hasElse = true;
        branches.push({
          label: "false",
          labelKey: "false",
          body: blockOf(inner),
        });
        alt = null;
      }
    }
    branchesOf(
      id,
      branches,
      hasElse ? null : { label: "false", labelKey: "false" },
    );
  };

  /** `switch`: one condition, one branch per `case`, plus the `default`. */
  const switchCondition = (statement: Node) => {
    const id = place({
      kind: "condition",
      label: conditionText(statement.childForFieldName("value")),
      range: lineRange(statement),
      openable: false,
    });
    const clauses = (
      statement.childForFieldName("body")?.namedChildren ?? []
    ).filter((c) => c.type === "switch_case" || c.type === "switch_default");
    const branches = clauses.map((clause) => ({
      label:
        clause.type === "switch_default"
          ? "padrão"
          : oneLine(clause.childForFieldName("value")?.text ?? ""),
      // The `default` is the system's word; a `case` is the code's.
      ...(clause.type === "switch_default"
        ? { labelKey: "default" as const }
        : {}),
      body: expand(clause.childrenForFieldName("body")),
    }));
    const hasDefault = clauses.some((c) => c.type === "switch_default");
    branchesOf(
      id,
      branches,
      hasDefault ? null : { label: "nenhum", labelKey: "none" },
    );
  };

  /** Loops and `try` become a node that opens into its own steps. */
  const opener = (statement: Node) => {
    const isLoop = LOOPS.has(statement.type);
    const id = place({
      kind: isLoop ? "loop" : "block",
      label: isLoop ? loopHeader(statement) : "try",
      range: lineRange(statement),
      openable: true,
    });
    const inner = isLoop
      ? blockOf(statement.childForFieldName("body"))
      : tryStatements(statement);
    sequence(inner, id, id, ctx);
  };

  /** `return`: a step of its own with no outgoing wire. */
  const returnStep = (statement: Node, expression: Node | null) => {
    const node: Omit<FlowNode, "id" | "parentId"> = {
      kind: "return",
      label: oneLine(expression?.text ?? ""),
      range: lineRange(statement),
      openable: false,
    };
    const resolved = resolveCall(statement, ctx.call);
    if (resolved?.kind === "call") node.target = resolved.target;
    if (resolved?.kind === "external") {
      node.callee = resolved.callee;
      node.category = resolved.category;
    }
    place(node);
    pending = [];
  };

  for (const statement of body) {
    if (isIgnored(statement)) continue;
    if (statement.id === ctx.implicitReturn) {
      flush();
      returnStep(statement, statement);
      continue;
    }
    if (statement.type === "if_statement") {
      flush();
      condition(statement);
      continue;
    }
    if (statement.type === "switch_statement") {
      flush();
      switchCondition(statement);
      continue;
    }
    if (LOOPS.has(statement.type) || statement.type === "try_statement") {
      flush();
      opener(statement);
      continue;
    }
    if (statement.type === "return_statement") {
      flush();
      returnStep(
        statement,
        statement.namedChildren.find((c) => c.type !== "comment") ?? null,
      );
      continue;
    }
    const resolved = resolveCall(statement, ctx.call);
    if (resolved === null) {
      group.push(statement);
      continue;
    }
    flush();
    if (resolved.kind === "dynamic") {
      place({
        kind: "code",
        label: "Código",
        range: lineRange(statement),
        openable: false,
        callee: resolved.callee,
      });
    } else if (resolved.kind === "call") {
      place({
        kind: "call",
        label:
          resolved.label ?? ctx.names.get(resolved.target) ?? resolved.target,
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

/**
 * Appends the steps of `body` as children of `parentId`, the function, class
 * or module that owns them. A function called only inside a callback is not a
 * step, but `parentId` still depends on it: a `calls` wire, unless a step
 * already calls it.
 */
export function buildSteps(
  body: Node[],
  parentId: NodeId,
  ctx: StepContext,
): void {
  const first = ctx.nodes.length;
  sequence(body, parentId, parentId, ctx);
  const stepped = new Set(
    ctx.nodes.slice(first).flatMap((n) => (n.target ? [n.target] : [])),
  );
  for (const statement of body) {
    if (isIgnored(statement)) continue;
    for (const target of deferredTargets(statement, ctx.call)) {
      if (stepped.has(target)) continue;
      stepped.add(target);
      ctx.edges.push({
        id: `calls:${parentId}->${target}`,
        kind: "calls",
        source: parentId,
        target,
      });
    }
  }
}
