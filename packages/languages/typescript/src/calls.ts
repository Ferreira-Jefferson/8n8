import type { ExternalCategory, NodeId } from "@8n8/model";
import type { Node } from "web-tree-sitter";
import { classify, classifyUnknown } from "./classify";
import type { Binding } from "./imports";

export interface CallContext {
  /** Top-level function and class names to their node ids. */
  topLevel: Map<string, NodeId>;
  /** Methods of the enclosing class (inherited ones included) to their node ids; empty outside a class. */
  methods: Map<string, NodeId>;
  /** Fields of the enclosing class that hold an instance of a known class (`repo` of `private repo: Repo`) to the class id. */
  fields: Map<string, NodeId>;
  /** Local import names to what they were imported as. */
  aliases: Map<string, Binding>;
  /**
   * Project node behind an import: the binding and the names read through
   * it (see `importPath`), or null.
   */
  resolveImport?: (binding: Binding, path: string[]) => NodeId | null;
  /** The methods of a class of the snippet or the project, by name; undefined for anything else. */
  methodsOf?: (classId: NodeId) => Map<string, NodeId> | undefined;
  /** Whether a package specifier names code of the project (a workspace package, a `paths` alias). A relative one always does. */
  projectModule?: (specifier: string) => boolean;
  /** The `new C()` value of a name, by the block that declares it: filled as calls ask for it. */
  instances?: Map<number, Map<string, Node | null>>;
  /**
   * Names the file binds (see `boundNames`). A call whose first segment is
   * not here, and is not imported, is classified with `classifyUnknown`.
   */
  bound: Set<string>;
}

export type CallResolution =
  | { kind: "call"; target: NodeId; label?: string }
  | { kind: "external"; callee: string; category: ExternalCategory };

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

/** The names a call reads from the module behind `binding`: `Repo.create` of `import { Repo }` is `Repo`, `create`. */
export function importPath(binding: Binding, rest: string[]): string[] {
  if (binding.kind === "named") return [binding.imported ?? "", ...rest];
  if (binding.kind === "default") return ["default", ...rest];
  return rest;
}

/** Whether the id names a class: its last segment is `cls:X`. */
export function isClassId(id: NodeId): boolean {
  return (id.split("/").pop() ?? "").startsWith("cls:");
}

/** The class a dotted name refers to: the snippet's, or a project class by import; null otherwise. */
export function classNamed(name: string, ctx: CallContext): NodeId | null {
  const [head = name, ...rest] = name.split(".");
  const binding = ctx.aliases.get(head);
  const target =
    rest.length === 0 && ctx.topLevel.has(name)
      ? (ctx.topLevel.get(name) ?? null)
      : binding === undefined
        ? null
        : (ctx.resolveImport?.(binding, importPath(binding, rest)) ?? null);
  return target !== null && isClassId(target) ? target : null;
}

/** The class of `new C()`, or null for any other value. */
export function classOfValue(
  value: Node | null,
  ctx: CallContext,
): NodeId | null {
  if (value?.type !== "new_expression") return null;
  const ctor = value.childForFieldName("constructor");
  const name = ctor ? dottedName(ctor) : null;
  return name === null ? null : classNamed(name, ctx);
}

const SCOPES = new Set(["statement_block", "program"]);

/** The value each name of a block is declared with (null for a declaration with another value). */
function declaredIn(block: Node, ctx: CallContext): Map<string, Node | null> {
  const cached = ctx.instances?.get(block.id);
  if (cached !== undefined) return cached;
  const out = new Map<string, Node | null>();
  for (const child of block.namedChildren) {
    const statement =
      child.type === "export_statement"
        ? child.childForFieldName("declaration")
        : child;
    if (
      statement?.type !== "lexical_declaration" &&
      statement?.type !== "variable_declaration"
    )
      continue;
    for (const d of statement.namedChildren) {
      const name = d.childForFieldName("name");
      if (d.type === "variable_declarator" && name?.type === "identifier") {
        const value = d.childForFieldName("value");
        out.set(name.text, value?.type === "new_expression" ? value : null);
      }
    }
  }
  ctx.instances?.set(block.id, out);
  return out;
}

/**
 * The class of `name` at `from`: the nearest declaration of the name in the
 * blocks around, when it is `name = new C()`. A parameter of the same name in
 * between hides it.
 */
function instanceClass(
  from: Node,
  name: string,
  ctx: CallContext,
): NodeId | null {
  for (let node = from.parent; node !== null; node = node.parent) {
    const params = node.childForFieldName("parameters");
    if (
      node.childForFieldName("parameter")?.text === name ||
      (params?.type === "formal_parameters" &&
        params.descendantsOfType("identifier").some((p) => p.text === name))
    )
      return null;
    if (!SCOPES.has(node.type)) continue;
    const declared = declaredIn(node, ctx);
    if (declared.has(name))
      return classOfValue(declared.get(name) ?? null, ctx);
  }
  return null;
}

/** The method `x.m` names when `x` is a class (`Repo.create`) or an instance of one (`u.greet`, `this.repo.find`). */
function methodCall(
  call: Node,
  head: string,
  rest: string[],
  ctx: CallContext,
): NodeId | null {
  if (ctx.methodsOf === undefined) return null;
  let cls: NodeId | null = null;
  let method: string | undefined;
  if (head === "this" && rest.length === 2) {
    cls = ctx.fields.get(rest[0] ?? "") ?? null;
    method = rest[1];
  } else if (head !== "this" && rest.length === 1) {
    method = rest[0];
    const top = ctx.topLevel.get(head);
    cls =
      top !== undefined
        ? isClassId(top)
          ? top
          : null
        : ctx.aliases.has(head) || !ctx.bound.has(head)
          ? null
          : instanceClass(call, head, ctx);
  }
  return cls === null || method === undefined
    ? null
    : (ctx.methodsOf(cls)?.get(method) ?? null);
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
  if (name === null) return chainedMethod(fn);

  const local = ctx.topLevel.get(name);
  if (local !== undefined) return { kind: "call", target: local };
  const [head = name, ...rest] = name.split(".");
  if (head === "this" && rest.length === 1) {
    const method = ctx.methods.get(rest[0] ?? "");
    // The name, for an inherited method that is not among the names of the file.
    if (method !== undefined)
      return { kind: "call", target: method, label: rest[0] ?? name };
  }
  const method = methodCall(call, head, rest, ctx);
  if (method !== null) return { kind: "call", target: method, label: name };

  const binding = ctx.aliases.get(head);
  let callee = name;
  if (binding !== undefined) {
    callee = displayName(binding, head, rest);
    const target =
      ctx.resolveImport?.(binding, importPath(binding, rest)) ?? null;
    if (target !== null) return { kind: "call", target, label: name };
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
  // A call into the project's own code that did not resolve is no external call.
  const project =
    binding !== undefined &&
    (binding.module.startsWith(".") ||
      ctx.projectModule?.(binding.module) === true);
  if ((binding === undefined || project) && category === "EXTERNO") return null;
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
  const calls = [...found.values()].sort((a, b) => a.startIndex - b.startIndex);
  let external: CallResolution | null = null;
  for (const call of calls) {
    const resolved = resolveOne(call, ctx);
    if (resolved?.kind === "call") return resolved;
    external ??= resolved;
  }
  return external;
}
