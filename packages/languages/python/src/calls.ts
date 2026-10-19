import type { ExternalCategory, NodeId } from "@8n8/model";
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
  /** Methods of each top-level class of the snippet, by class name, to their node ids. */
  classMethods?: Map<string, Map<string, NodeId>>;
  /** Whether an imported full name points into a project module: a miss there is not an external call. */
  isProjectName?: (fullName: string) => boolean;
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
  | { kind: "external"; callee: string; category: ExternalCategory }
  /** A call whose target only exists when the code runs: `handlers[k]()`, `getattr(o, n)()`. */
  | { kind: "dynamic"; callee: string };

/** Nodes whose body runs later, not where they are written: a lambda, a nested `def`, a class. */
const DEFERRED = new Set(["lambda", "function_definition", "class_definition"]);

/** Whether `call` sits in a function or class written inside `statement` (the statement itself included). */
function isDeferred(call: Node, statement: Node): boolean {
  for (let n: Node | null = call; n !== null; n = n.parent) {
    if (DEFERRED.has(n.type)) return true;
    if (n.id === statement.id) return false;
  }
  return false;
}

/** `a`, `a.b`, `a.b.c`...; null when the expression is not a plain dotted name. */
export function dottedName(node: Node): string | null {
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

/** Nodes that open a scope of names. */
const SCOPES = new Set([
  "module",
  "function_definition",
  "class_definition",
  "lambda",
]);

/** Per tree and scope: each name to its assignments, as [start, class called or null], in code order. */
const assignmentsCache = new WeakMap<
  object,
  Map<number, Map<string, [number, string | null][]>>
>();

function assignmentsOf(scope: Node): Map<string, [number, string | null][]> {
  const byScope = assignmentsCache.get(scope.tree) ?? new Map();
  assignmentsCache.set(scope.tree, byScope);
  const cached = byScope.get(scope.id);
  if (cached) return cached;
  const names = new Map<string, [number, string | null][]>();
  const visit = (node: Node) => {
    for (const child of node.namedChildren) {
      if (SCOPES.has(child.type)) continue;
      const left =
        child.type === "assignment" && child.childForFieldName("left");
      if (left && left.type === "identifier") {
        const right = child.childForFieldName("right");
        const fn =
          right?.type === "call" && right.childForFieldName("function");
        const list = names.get(left.text) ?? [];
        list.push([child.startIndex, fn ? dottedName(fn) : null]);
        names.set(left.text, list);
      }
      visit(child);
    }
  };
  visit(scope);
  byScope.set(scope.id, names);
  return names;
}

/** The class `name` was made from before `call`, in the same scope: `u = User(...)` gives `User`; null otherwise. */
function instanceClass(call: Node, name: string): string | null {
  let scope = call.parent;
  while (scope && !SCOPES.has(scope.type)) scope = scope.parent;
  if (!scope) return null;
  const before = (assignmentsOf(scope).get(name) ?? []).filter(
    ([start]) => start < call.startIndex,
  );
  return before[before.length - 1]?.[1] ?? null;
}

/** The method `method` of the class named `cls`: a class of the snippet, or of the project by import. */
function classMethod(
  cls: string,
  method: string,
  ctx: CallContext,
): NodeId | null {
  const local = ctx.classMethods?.get(cls)?.get(method);
  if (local !== undefined) return local;
  const [head = cls, ...rest] = cls.split(".");
  const imported = ctx.aliases.get(head);
  if (imported === undefined) return null;
  return ctx.resolveImport?.([imported, ...rest, method].join(".")) ?? null;
}

function resolveOne(call: Node, ctx: CallContext): CallResolution | null {
  const fn = call.childForFieldName("function");
  const name = fn ? dottedName(fn) : null;
  if (name === null) {
    if (fn?.type === "subscript" || fn?.type === "call") {
      return { kind: "dynamic", callee: fn.text };
    }
    return chainedMethod(fn);
  }

  const local = ctx.topLevel.get(name);
  if (local !== undefined) return { kind: "call", target: local };
  const [head = name, ...rest] = name.split(".");
  if (head === "self" && rest.length === 1) {
    const method = ctx.methods.get(rest[0] ?? "");
    if (method !== undefined) return { kind: "call", target: method };
  }
  // `Repo.create()` on a class of the snippet, or `u.greet()` after `u = User(...)`.
  const member = rest.length === 1 ? rest[0] : undefined;
  if (member !== undefined && head !== "self") {
    const cls = ctx.classMethods?.has(head) ? head : instanceClass(call, head);
    const target = cls === null ? null : classMethod(cls, member, ctx);
    if (target !== null) return { kind: "call", target, label: name };
  }

  const imported = ctx.aliases.get(head);
  const callee = imported === undefined ? name : [imported, ...rest].join(".");
  if (imported !== undefined) {
    const target = ctx.resolveImport?.(callee) ?? null;
    if (target !== null) return { kind: "call", target, label: name };
    // A name of the project that does not resolve stays a plain step, not an external call.
    const project =
      callee.startsWith(".") || (ctx.isProjectName?.(callee) ?? false);
    if (project && classify(callee) === "EXTERNO") return null;
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

/** Whether the result of `call` is called right away, as `make()` in `make()()`. */
function isCalled(call: Node): boolean {
  return (
    call.parent?.type === "call" &&
    call.parent.childForFieldName("function")?.id === call.id
  );
}

/** The calls of a statement in code order. */
function callsOf(statement: Node): Node[] {
  return statement
    .descendantsOfType("call")
    .sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * Decides whether a statement is a `call` step, an `external` step, a
 * `dynamic` step or neither. A call to the snippet wins; otherwise the first
 * external call in code order counts, then the first dynamic one. A call
 * inside a lambda or a nested `def` does not run here and does not count.
 */
export function resolveCall(
  statement: Node,
  ctx: CallContext,
): CallResolution | null {
  let external: CallResolution | null = null;
  let dynamic: CallResolution | null = null;
  for (const call of callsOf(statement)) {
    if (isDeferred(call, statement)) continue;
    const resolved = resolveOne(call, ctx);
    if (resolved?.kind === "call") return resolved;
    if (resolved?.kind === "dynamic") dynamic ??= resolved;
    // `getattr(o, n)` in `getattr(o, n)()` only finds the target of the dynamic call.
    else if (!isCalled(call)) external ??= resolved;
  }
  return external ?? dynamic;
}

/** The snippet's functions called inside a lambda or a nested `def` of `statement`: a dependency, not a step. */
export function deferredTargets(statement: Node, ctx: CallContext): NodeId[] {
  const targets: NodeId[] = [];
  for (const call of callsOf(statement)) {
    if (!isDeferred(call, statement)) continue;
    const resolved = resolveOne(call, ctx);
    if (resolved?.kind === "call") targets.push(resolved.target);
  }
  return targets;
}
