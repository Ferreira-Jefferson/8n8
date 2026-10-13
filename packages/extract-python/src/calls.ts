import type { ExternalCategory, NodeId } from "@code2n8n/model";
import type { Node } from "web-tree-sitter";
import { classify } from "./classify";

export interface CallContext {
  /** Top-level `def` and `class` names to their node ids. */
  topLevel: Map<string, NodeId>;
  /** Methods of the enclosing class to their node ids; empty outside a class. */
  methods: Map<string, NodeId>;
  /** Local import names to full names (see `importAliases`). */
  aliases: Map<string, string>;
}

export type CallResolution =
  | { kind: "call"; target: NodeId }
  | { kind: "external"; callee: string; category: ExternalCategory };

/** `a`, `a.b`, `a.b.c`...; null when the expression is not a plain dotted name. */
function dottedName(node: Node): string | null {
  if (node.type === "identifier") return node.text;
  if (node.type !== "attribute") return null;
  const object = node.childForFieldName("object");
  const attribute = node.childForFieldName("attribute");
  const head = object ? dottedName(object) : null;
  return head !== null && attribute ? `${head}.${attribute.text}` : null;
}

function resolveOne(call: Node, ctx: CallContext): CallResolution | null {
  const fn = call.childForFieldName("function");
  const name = fn ? dottedName(fn) : null;
  if (name === null) return null;

  const local = ctx.topLevel.get(name);
  if (local !== undefined) return { kind: "call", target: local };
  const [head = name, ...rest] = name.split(".");
  if (head === "self" && rest.length === 1) {
    const method = ctx.methods.get(rest[0] ?? "");
    if (method !== undefined) return { kind: "call", target: method };
  }

  const imported = ctx.aliases.get(head);
  const callee = imported === undefined ? name : [imported, ...rest].join(".");
  const category = classify(callee);
  if (imported === undefined && category === "EXTERNO") return null;
  return { kind: "external", callee, category };
}

/**
 * Decides whether a statement is a `call` step, an `external` step or
 * neither. A call to the snippet wins; otherwise the first external call in
 * code order counts.
 */
export function resolveCall(
  statement: Node,
  ctx: CallContext,
): CallResolution | null {
  const calls = statement
    .descendantsOfType("call")
    .sort((a, b) => a.startIndex - b.startIndex);
  let external: CallResolution | null = null;
  for (const call of calls) {
    const resolved = resolveOne(call, ctx);
    if (resolved?.kind === "call") return resolved;
    external ??= resolved;
  }
  return external;
}
