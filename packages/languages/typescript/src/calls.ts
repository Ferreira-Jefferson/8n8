import type { ExternalCategory, NodeId } from "@8n8/model";
import type { Node } from "web-tree-sitter";
import { classify, classifyUnknown } from "./classify";
import type { Binding } from "./imports";

export interface CallContext {
  /** Top-level function and class names to their node ids. */
  topLevel: Map<string, NodeId>;
  /** Methods of the enclosing class to their node ids; empty outside a class. */
  methods: Map<string, NodeId>;
  /** Local import names to what they were imported as. */
  aliases: Map<string, Binding>;
  /**
   * Project node behind an import: the binding and the member read from it
   * (`null` when the call does not name one), or null.
   */
  resolveImport?: (binding: Binding, member: string | null) => NodeId | null;
  /**
   * Names the file binds (see `boundNames`). A call whose first segment is
   * not here, and is not imported, is classified with `classifyUnknown`.
   */
  bound: Set<string>;
}

export type CallResolution =
  | { kind: "call"; target: NodeId; label?: string }
  | { kind: "external"; callee: string; category: ExternalCategory }
  /** A call whose target only exists when the code runs: `handlers[k]()`, `make()()`, `mod.f()` after `import()`. */
  | { kind: "dynamic"; callee: string };

/** Nodes whose body runs later, not where they are written: a callback, a nested function, a class. */
const DEFERRED = new Set([
  "arrow_function",
  "function_expression",
  "function",
  "function_declaration",
  "generator_function",
  "generator_function_declaration",
  "method_definition",
  "class",
  "class_declaration",
  "abstract_class_declaration",
]);

/** Whether `call` sits in a function or class written inside `statement` (the statement itself included). */
function isDeferred(call: Node, statement: Node): boolean {
  for (let n: Node | null = call; n !== null; n = n.parent) {
    if (DEFERRED.has(n.type)) return true;
    if (n.id === statement.id) return false;
  }
  return false;
}

/** Names bound to a module loaded when the code runs: `const mod = await import("./x")`. */
const runtimeImports = new WeakMap<object, Set<string>>();

function importedAtRuntime(node: Node): Set<string> {
  const known = runtimeImports.get(node.tree);
  if (known) return known;
  const names = new Set<string>();
  for (const d of node.tree.rootNode.descendantsOfType("variable_declarator")) {
    let value = d.childForFieldName("value");
    if (value?.type === "await_expression")
      value = value.namedChildren[0] ?? null;
    const name = d.childForFieldName("name");
    if (
      name?.type === "identifier" &&
      value?.type === "call_expression" &&
      value.childForFieldName("function")?.type === "import"
    ) {
      names.add(name.text);
    }
  }
  runtimeImports.set(node.tree, names);
  return names;
}

/** `a`, `this.b`, `a.b.c`...; null when the expression is not a plain dotted name. */
export function dottedName(node: Node): string | null {
  if (node.type === "identifier" || node.type === "this") return node.text;
  if (node.type === "non_null_expression") {
    const inner = node.namedChildren[0];
    return inner ? dottedName(inner) : null;
  }
  if (node.type !== "member_expression") return null;
  const object = node.childForFieldName("object");
  const property = node.childForFieldName("property");
  const head = object ? dottedName(object) : null;
  return head !== null && property ? `${head}.${property.text}` : null;
}

/**
 * A method on a receiver that is not a dotted name, such as
 * `(await pool.connect()).query` or `rows[0].execute`. Only a method from
 * the table counts; any other method does not.
 */
function chainedMethod(fn: Node | null): CallResolution | null {
  const property =
    fn?.type === "member_expression" && fn.childForFieldName("property");
  if (!fn || !property) return null;
  const category = classify(`.${property.text}`);
  if (category === "EXTERNO") return null;
  return { kind: "external", callee: fn.text, category };
}

/** The member a call reads from the module behind `binding`, or null. */
export function memberOf(binding: Binding, rest: string[]): string | null {
  if (binding.kind === "named")
    return rest.length === 0 ? binding.imported : null;
  if (binding.kind === "default") return rest.length === 0 ? "default" : null;
  return rest.length === 1 ? (rest[0] ?? null) : null;
}

/** `import fs from "node:fs"` + `fs.readFile` is `fs.readFile`; `import x from "./x"` keeps `x`. */
function displayName(binding: Binding, head: string, rest: string[]): string {
  if (binding.kind === "named")
    return [binding.imported ?? head, ...rest].join(".");
  const root = binding.module.startsWith(".")
    ? head
    : binding.module.replace(/^node:/, "");
  return [root, ...rest].join(".");
}

function resolveOne(call: Node, ctx: CallContext): CallResolution | null {
  const fn =
    call.type === "new_expression"
      ? call.childForFieldName("constructor")
      : call.childForFieldName("function");
  const name = fn ? dottedName(fn) : null;
  if (name === null) {
    if (fn?.type === "subscript_expression" || fn?.type === "call_expression") {
      return { kind: "dynamic", callee: fn.text };
    }
    return chainedMethod(fn);
  }

  const local = ctx.topLevel.get(name);
  if (local !== undefined) return { kind: "call", target: local };
  const [head = name, ...rest] = name.split(".");
  if (head === "this" && rest.length === 1) {
    const method = ctx.methods.get(rest[0] ?? "");
    if (method !== undefined) return { kind: "call", target: method };
  }

  const binding = ctx.aliases.get(head);
  let callee = name;
  if (binding !== undefined) {
    callee = displayName(binding, head, rest);
    const member = memberOf(binding, rest);
    const target =
      member === null ? null : (ctx.resolveImport?.(binding, member) ?? null);
    if (target !== null) return { kind: "call", target, label: name };
  } else if (rest.length > 0 && importedAtRuntime(call).has(head)) {
    return { kind: "dynamic", callee: name };
  }
  // The receiver of a chained method, as `foo()` in `foo().push(x)`, keeps
  // only the table, so the chain stays judged by `chainedMethod`.
  const receiver =
    call.parent?.type === "member_expression" &&
    call.parent.childForFieldName("object")?.id === call.id;
  if (!receiver && binding === undefined && !ctx.bound.has(head)) {
    // A name the snippet neither defines nor imports.
    return { kind: "external", callee, category: classifyUnknown(callee) };
  }
  const category = classify(callee, binding?.module);
  if (binding === undefined && category === "EXTERNO") return null;
  return { kind: "external", callee, category };
}

/** Whether the result of `call` is called right away, as `make()` in `make()()`. */
function isCalled(call: Node): boolean {
  return (
    call.parent?.type === "call_expression" &&
    call.parent.childForFieldName("function")?.id === call.id
  );
}

/** The calls of a statement in code order, the statement itself included. */
function callsOf(statement: Node): Node[] {
  const found = new Map<number, Node>();
  for (const node of statement.descendantsOfType([
    "call_expression",
    "new_expression",
  ])) {
    found.set(node.id, node);
  }
  if (
    statement.type === "call_expression" ||
    statement.type === "new_expression"
  ) {
    found.set(statement.id, statement);
  }
  return [...found.values()].sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * Decides whether a statement is a `call` step, an `external` step, a
 * `dynamic` step or neither. A call to the snippet wins; otherwise the first
 * external call in code order counts, then the first dynamic one. A call
 * inside a callback or a nested function does not run here and does not count.
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
    // `pick(k)` in `pick(k)()` only finds the target of the dynamic call.
    else if (!isCalled(call)) external ??= resolved;
  }
  return external ?? dynamic;
}

/** The snippet's functions called inside a callback or a nested function of `statement`: a dependency, not a step. */
export function deferredTargets(statement: Node, ctx: CallContext): NodeId[] {
  const targets: NodeId[] = [];
  for (const call of callsOf(statement)) {
    if (!isDeferred(call, statement)) continue;
    const resolved = resolveOne(call, ctx);
    if (resolved?.kind === "call") targets.push(resolved.target);
  }
  return targets;
}
