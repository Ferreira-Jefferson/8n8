import type { ExternalCategory, NodeId } from "@code2n8n/model";
import type { Node } from "web-tree-sitter";
import { classify, classifyUnknown } from "./classify";

export interface CallContext {
  /** Top-level `def` and `class` names to their node ids. */
  topLevel: Map<string, NodeId>;
  /** Methods of the enclosing class to their node ids; empty outside a class. */
  methods: Map<string, NodeId>;
  /** Local import names to full names (see `importAliases`). */
  aliases: Map<string, string>;
  /** Project node behind an imported full name, or null (PROJ-04). */
  resolveImport?: (fullName: string) => NodeId | null;
  /** Top-level names defined anywhere in the project (PROJ-09). */
  projectNames?: Set<string>;
  /**
   * Names the file binds (see `boundNames`). A call whose first segment is
   * not here is classified with `classifyUnknown` (VID-13). When absent,
   * every name counts as bound.
   */
  // SPEC_DEVIATION: optional here; the design has `bound: Set<string>`.
  // Reason: tasks.md T6 requires project-calls.test.ts to pass unchanged, and
  // it builds a context without `bound`. `buildGraph` always fills it.
  bound?: Set<string>;
}

export type CallResolution =
  | { kind: "call"; target: NodeId; label?: string }
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

/**
 * A method on a receiver that is not a dotted name, such as
 * `conn.cursor().execute` or `c[0].commit`. Only a method from the table
 * counts; any other method stays a local method and does not count.
 */
function chainedMethod(fn: Node | null): CallResolution | null {
  const attribute =
    fn?.type === "attribute" && fn.childForFieldName("attribute");
  if (!fn || !attribute) return null;
  const category = classify(`.${attribute.text}`);
  if (category === "EXTERNO") return null;
  return { kind: "external", callee: fn.text, category };
}

function resolveOne(call: Node, ctx: CallContext): CallResolution | null {
  const fn = call.childForFieldName("function");
  const name = fn ? dottedName(fn) : null;
  if (name === null) return chainedMethod(fn);

  const local = ctx.topLevel.get(name);
  if (local !== undefined) return { kind: "call", target: local };
  const [head = name, ...rest] = name.split(".");
  if (head === "self" && rest.length === 1) {
    const method = ctx.methods.get(rest[0] ?? "");
    if (method !== undefined) return { kind: "call", target: method };
  }

  const imported = ctx.aliases.get(head);
  const callee = imported === undefined ? name : [imported, ...rest].join(".");
  if (imported !== undefined) {
    const target = ctx.resolveImport?.(callee) ?? null;
    if (target !== null) return { kind: "call", target, label: name };
  }
  // The receiver of a chained method, as `foo()` in `foo().append(x)`, keeps
  // only the table (design A2), so the chain stays judged by `chainedMethod`.
  const receiver = call.parent?.type === "attribute";
  if (
    !receiver &&
    imported === undefined &&
    ctx.bound &&
    !ctx.bound.has(head)
  ) {
    // A name the snippet neither defines nor imports (VID-13).
    return { kind: "external", callee, category: classifyUnknown(callee) };
  }
  const category = classify(callee);
  if (imported === undefined && category === "EXTERNO") {
    // A project name used without an import is not resolved (PROJ-09).
    if (rest.length === 0 && ctx.projectNames?.has(name)) {
      return { kind: "external", callee, category };
    }
    return null;
  }
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
