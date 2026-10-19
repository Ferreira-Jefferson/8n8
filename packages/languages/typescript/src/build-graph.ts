import { lineRange } from "@8n8/lang-treesitter";
import {
  childId,
  type FlowEdge,
  type FlowNode,
  type Graph,
  type LineRange,
  type NodeId,
  topLevelId,
} from "@8n8/model";
import type { Node, Tree } from "web-tree-sitter";
import { boundNames } from "./bound";
import {
  type CallContext,
  classNamed,
  classOfValue,
  dottedName,
} from "./calls";
import { importBindings } from "./imports";
import { blockOf, buildSteps, isIgnored } from "./steps";

/** A contiguous run of nodes in pre-order, with the wires created inside it. */
interface Chunk {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface Scope {
  call: CallContext;
  names: Map<NodeId, string>;
}

/** A function or class found in a statement. */
interface Definition {
  kind: "function" | "class";
  name: string;
  /** The node that has the `body`: the function, method or class. */
  node: Node;
  /** The node whose lines the definition takes: with `export`, decorators... */
  outer: Node;
}

const FUNCTION_DECLARATIONS = new Set([
  "function_declaration",
  "generator_function_declaration",
]);
const FUNCTION_VALUES = new Set([
  "arrow_function",
  "function_expression",
  "generator_function",
]);
const CLASS_DECLARATIONS = new Set([
  "class_declaration",
  "abstract_class_declaration",
]);

function nameOf(node: Node): string {
  return node.childForFieldName("name")?.text ?? "";
}

/**
 * The function or class behind a statement, or null: `function f`, `class C`,
 * `const f = () => ...` (one declarator), each with an optional `export`.
 * An anonymous `export default` is named `default`.
 */
export function definitionOf(statement: Node): Definition | null {
  const exported = statement.type === "export_statement";
  const inner = exported
    ? (statement.childForFieldName("declaration") ??
      statement.childForFieldName("value"))
    : statement;
  if (!inner) return null;
  const outer = statement;
  if (FUNCTION_DECLARATIONS.has(inner.type)) {
    return { kind: "function", name: nameOf(inner), node: inner, outer };
  }
  if (
    CLASS_DECLARATIONS.has(inner.type) ||
    (exported && inner.type === "class")
  ) {
    return {
      kind: "class",
      name: nameOf(inner) || "default",
      node: inner,
      outer,
    };
  }
  if (exported && FUNCTION_VALUES.has(inner.type)) {
    return {
      kind: "function",
      name: nameOf(inner) || "default",
      node: inner,
      outer,
    };
  }
  if (
    inner.type === "lexical_declaration" ||
    inner.type === "variable_declaration"
  ) {
    const declarators = inner.namedChildren.filter(
      (c) => c.type === "variable_declarator",
    );
    const [only] = declarators;
    const name = only?.childForFieldName("name");
    const value = only?.childForFieldName("value");
    if (
      declarators.length === 1 &&
      name?.type === "identifier" &&
      value &&
      FUNCTION_VALUES.has(value.type)
    ) {
      return { kind: "function", name: name.text, node: value, outer };
    }
  }
  return null;
}

/** A method, or a class field holding a function: `m() {}`, `m = () => {}`. */
function memberOf(member: Node): Definition | null {
  if (member.type === "method_definition") {
    return {
      kind: "function",
      name: nameOf(member),
      node: member,
      outer: member,
    };
  }
  if (member.type === "public_field_definition") {
    const value = member.childForFieldName("value");
    if (value && FUNCTION_VALUES.has(value.type)) {
      return {
        kind: "function",
        name: nameOf(member),
        node: value,
        outer: member,
      };
    }
  }
  return null;
}

/** `outer` with the decorators that sit before it as siblings (class members). */
function withDecorators(outer: Node): Node {
  let first = outer;
  while (first.previousSibling?.type === "decorator") {
    first = first.previousSibling;
  }
  return first;
}

/** The `/** ... *\/` comment right above `first`, as `{ docstring }`; else nothing. */
function jsdocAbove(first: Node): { docstring: LineRange } | object {
  const above = first.previousSibling;
  return above?.type === "comment" &&
    above.text.startsWith("/**") &&
    above.endPosition.row + 1 === first.startPosition.row
    ? { docstring: lineRange(above) }
    : {};
}

/**
 * The module's JSDoc: a `/** *\/` comment that opens the file and is not the
 * comment of the definition right below it.
 */
function moduleDoc(statements: Node[]): LineRange | null {
  const [first, second] = statements;
  if (first?.type !== "comment" || !first.text.startsWith("/**")) return null;
  const claimed =
    second !== undefined &&
    definitionOf(second) !== null &&
    first.endPosition.row + 1 === second.startPosition.row;
  return claimed ? null : lineRange(first);
}

/** Assigns `fn:x`, `cls:X`, `fn:x#2`... in code order. */
function idAllocator(): (kind: "function" | "class", name: string) => NodeId {
  const seen = new Map<string, number>();
  return (kind, name) => {
    const key = `${kind}:${name}`;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    return topLevelId(kind, name, occurrence);
  };
}

/** The steps of a function: its block, or the expression of an arrow as a `return`. */
function bodyOf(node: Node): { statements: Node[]; implicitReturn?: number } {
  const body = node.childForFieldName("body");
  if (!body) return { statements: [] };
  if (body.type === "statement_block") return { statements: blockOf(body) };
  return { statements: [body], implicitReturn: body.id };
}

/** `head` (if any) followed by the steps of `body` under `parentId`. */
function withSteps(
  head: FlowNode | null,
  body: Node[],
  parentId: NodeId,
  scope: Scope,
  implicitReturn?: number,
): Chunk {
  const chunk: Chunk = { nodes: head ? [head] : [], edges: [] };
  buildSteps(body, parentId, {
    ...scope,
    ...chunk,
    ...(implicitReturn === undefined ? {} : { implicitReturn }),
  });
  return chunk;
}

/**
 * Lays out definitions in code order. The loose statements form one chunk,
 * placed where the first of them appears.
 */
function layout(
  statements: Node[],
  defOf: (statement: Node) => Definition | null,
  onDefinition: (def: Definition, index: number) => Chunk,
  onLoose: (loose: Node[]) => Chunk,
): Chunk[] {
  const chunks: Chunk[] = [];
  const loose: Node[] = [];
  let looseAt = -1;
  let defIndex = 0;
  for (const statement of statements) {
    if (isIgnored(statement)) continue;
    const def = defOf(statement);
    if (def === null) {
      if (loose.length === 0) looseAt = chunks.length;
      loose.push(statement);
    } else {
      chunks.push(onDefinition(def, defIndex++));
    }
  }
  if (loose.length > 0) chunks.splice(looseAt, 0, onLoose(loose));
  return chunks;
}

function merge(chunks: Chunk[]): Chunk {
  return {
    nodes: chunks.flatMap((c) => c.nodes),
    edges: chunks.flatMap((c) => c.edges),
  };
}

function definitionNode(
  def: Definition,
  id: NodeId,
  parentId: NodeId | null,
): FlowNode {
  const first = withDecorators(def.outer);
  return {
    id,
    kind: def.kind,
    label: def.name,
    parentId,
    range: { start: lineRange(first).start, end: lineRange(def.outer).end },
    openable: true,
    ...jsdocAbove(first),
  };
}

function buildFunction(
  def: Definition,
  id: NodeId,
  parentId: NodeId | null,
  scope: Scope,
): Chunk {
  const { statements, implicitReturn } = bodyOf(def.node);
  return withSteps(
    definitionNode(def, id, parentId),
    statements,
    id,
    scope,
    implicitReturn,
  );
}

/** The methods of a class in code order, with their ids under `id`; the last one with a name wins. */
function methodIds(
  classNode: Node,
  id: NodeId,
): { ids: NodeId[]; methods: Map<string, NodeId>; names: Map<NodeId, string> } {
  const methodId = idAllocator();
  const ids: NodeId[] = [];
  const methods = new Map<string, NodeId>();
  const names = new Map<NodeId, string>();
  for (const member of classNode.childForFieldName("body")?.namedChildren ??
    []) {
    const method = memberOf(member);
    if (method === null) continue;
    const mid = childId(id, methodId("function", method.name));
    ids.push(mid);
    methods.set(method.name, mid);
    names.set(mid, method.name);
  }
  return { ids, methods, names };
}

/** The class named by a type annotation: `Repo`, `Repo<T>`, `ns.Repo`. */
function annotatedClass(
  annotation: Node | null,
  ctx: CallContext,
): NodeId | null {
  let type = annotation?.namedChildren[0] ?? null;
  if (type?.type === "generic_type") type = type.namedChildren[0] ?? null;
  return type?.type === "type_identifier" ||
    type?.type === "nested_type_identifier"
    ? classNamed(type.text, ctx)
    : null;
}

/**
 * The fields of a class that hold an instance of a known class:
 * `private repo: Repo`, `repo = new Repo()`, and the parameter properties
 * of the constructor (`constructor(private repo: Repo)`).
 */
function fieldClasses(body: Node[], ctx: CallContext): Map<string, NodeId> {
  const fields = new Map<string, NodeId>();
  const add = (name: string | undefined, cls: NodeId | null) => {
    if (name !== undefined && cls !== null) fields.set(name, cls);
  };
  for (const member of body) {
    if (member.type === "public_field_definition") {
      add(
        member.childForFieldName("name")?.text,
        annotatedClass(member.childForFieldName("type"), ctx) ??
          classOfValue(member.childForFieldName("value"), ctx),
      );
    } else if (
      member.type === "method_definition" &&
      nameOf(member) === "constructor"
    ) {
      for (const param of member.childForFieldName("parameters")
        ?.namedChildren ?? []) {
        const property = param.children.some(
          (c) => c.type === "accessibility_modifier" || c.type === "readonly",
        );
        if (!property) continue;
        add(
          param.childForFieldName("pattern")?.text,
          annotatedClass(param.childForFieldName("type"), ctx),
        );
      }
    }
  }
  return fields;
}

function buildClass(
  def: Definition,
  id: NodeId,
  parentId: NodeId | null,
  scope: Scope,
): Chunk {
  const body = def.node.childForFieldName("body")?.namedChildren ?? [];
  const own = methodIds(def.node, id);
  const { ids } = own;
  const names = new Map([...scope.names, ...own.names]);
  const methods = scope.call.methodsOf?.(id) ?? own.methods;
  const inner: Scope = {
    call: {
      ...scope.call,
      methods,
      fields: fieldClasses(body, scope.call),
    },
    names,
  };

  const children = layout(
    body,
    memberOf,
    (method, index) => buildFunction(method, ids[index] ?? "", id, inner),
    (loose) => withSteps(null, loose, id, inner),
  );
  return merge([
    { nodes: [definitionNode(def, id, parentId)], edges: [] },
    ...children,
  ]);
}

const OWNERS = new Set(["function", "class", "module"]);

/** One `calls` wire per (caller, callee) pair, from the steps with a target. */
function callsEdges(nodes: FlowNode[]): FlowEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = new Map<string, FlowEdge>();
  for (const step of nodes) {
    if (step.target === undefined) continue;
    let owner = step.parentId === null ? undefined : byId.get(step.parentId);
    while (owner && !OWNERS.has(owner.kind)) {
      owner = owner.parentId === null ? undefined : byId.get(owner.parentId);
    }
    if (!owner) continue;
    const id = `calls:${owner.id}->${step.target}`;
    if (!edges.has(id)) {
      edges.set(id, {
        id,
        kind: "calls",
        source: owner.id,
        target: step.target,
      });
    }
  }
  return [...edges.values()];
}

/** The expression after `extends` in a class, or null. `implements` does not count. */
function baseOf(classNode: Node): Node | null {
  const heritage = classNode.namedChildren.find(
    (c) => c.type === "class_heritage",
  );
  const clause = heritage?.namedChildren.find(
    (c) => c.type === "extends_clause",
  );
  return clause?.childForFieldName("value") ?? null;
}

/** The dotted name after `extends`, or null. */
function baseName(classNode: Node): string | null {
  const base = baseOf(classNode);
  return base === null ? null : dottedName(base);
}

/**
 * One `extends` wire per (child, base) pair, for the top-level classes. A base
 * that is not a class of the snippet or the project makes no wire.
 */
function extendsEdges(
  statements: Node[],
  ids: NodeId[],
  ctx: CallContext,
): FlowEdge[] {
  const edges = new Map<string, FlowEdge>();
  let index = 0;
  for (const statement of statements) {
    if (isIgnored(statement)) continue;
    const def = definitionOf(statement);
    if (def === null) continue;
    const source = ids[index++] ?? "";
    const name = def.kind === "class" ? baseName(def.node) : null;
    const target = name === null ? null : classNamed(name, ctx);
    if (target === null || target === source) continue;
    const id = `extends:${source}->${target}`;
    if (!edges.has(id)) edges.set(id, { id, kind: "extends", source, target });
  }
  return [...edges.values()];
}

export interface TopLevel {
  /** Ids of the top-level definitions, in code order. */
  ids: NodeId[];
  /** Name to id; the last definition with a name wins. */
  topLevel: Map<string, NodeId>;
  /** Id to name, and to the kind of node. */
  names: Map<NodeId, string>;
  /** Each class by id: its own methods (name to the id under the class) and the dotted name it extends. */
  classes: Map<NodeId, { methods: Map<string, NodeId>; base: string | null }>;
}

/** Allocates `fn:x`, `fn:x#2`, `cls:X` for the top-level definitions of `root`. */
export function allocateTopLevel(root: Node): TopLevel {
  const topId = idAllocator();
  const ids: NodeId[] = [];
  const topLevel = new Map<string, NodeId>();
  const names = new Map<NodeId, string>();
  const classes: TopLevel["classes"] = new Map();
  for (const statement of root.namedChildren) {
    if (isIgnored(statement)) continue;
    const def = definitionOf(statement);
    if (def === null) continue;
    const id = topId(def.kind, def.name);
    ids.push(id);
    topLevel.set(def.name, id);
    names.set(id, def.name);
    if (def.kind === "class") {
      classes.set(id, {
        methods: methodIds(def.node, id).methods,
        base: baseName(def.node),
      });
    }
  }
  return { ids, topLevel, names, classes };
}

export interface BuildOptions {
  /** Parent of the top-level nodes, also prefixed to their ids. */
  prefix?: NodeId;
  resolveImport?: CallContext["resolveImport"];
  /** The methods of a project class of another file. */
  methodsOf?: CallContext["methodsOf"];
  projectModule?: CallContext["projectModule"];
}

/** Builds the graph of a parsed snippet or file. */
export function buildGraph(tree: Tree, options: BuildOptions = {}): Graph {
  const { prefix, resolveImport, projectModule } = options;
  const scoped = (id: NodeId) =>
    prefix === undefined ? id : childId(prefix, id);
  const parentId = prefix ?? null;
  const statements = tree.rootNode.namedChildren;
  const top = allocateTopLevel(tree.rootNode);
  const ids = top.ids.map(scoped);
  const classes = new Map(
    [...top.classes].map(([id, c]) => [scoped(id), c] as const),
  );
  const known = new Map<NodeId, Map<string, NodeId>>();
  /** A class of this file: its methods under the ones it inherits. Another class: the project's answer. */
  const methodsOf = (
    classId: NodeId,
    seen = new Set<NodeId>(),
  ): Map<string, NodeId> | undefined => {
    const cls = classes.get(classId);
    if (cls === undefined) return options.methodsOf?.(classId);
    const cached = known.get(classId);
    if (cached !== undefined) return cached;
    if (seen.has(classId)) return new Map();
    seen.add(classId);
    const base = cls.base === null ? null : classNamed(cls.base, scope.call);
    const methods = new Map([
      ...((base === null ? undefined : methodsOf(base, seen)) ?? []),
      ...[...cls.methods].map(([name, id]) => [name, scoped(id)] as const),
    ]);
    known.set(classId, methods);
    return methods;
  };
  const scope: Scope = {
    call: {
      topLevel: new Map(
        [...top.topLevel].map(([name, id]) => [name, scoped(id)]),
      ),
      methods: new Map(),
      fields: new Map(),
      aliases: importBindings(tree.rootNode),
      bound: boundNames(tree.rootNode),
      methodsOf,
      instances: new Map(),
      ...(resolveImport === undefined ? {} : { resolveImport }),
      ...(projectModule === undefined ? {} : { projectModule }),
    },
    names: new Map([...top.names].map(([id, name]) => [scoped(id), name])),
  };
  const moduleId = scoped("mod");

  const { nodes, edges } = merge(
    layout(
      statements,
      definitionOf,
      (def, index) => {
        const id = ids[index] ?? "";
        return def.kind === "class"
          ? buildClass(def, id, parentId, scope)
          : buildFunction(def, id, parentId, scope);
      },
      (loose) => {
        const first = loose[0];
        const last = loose[loose.length - 1];
        const doc = moduleDoc(statements);
        const start = first ? lineRange(first).start : 1;
        const head: FlowNode = {
          id: moduleId,
          kind: "module",
          label: "Módulo",
          parentId,
          range: {
            start: doc ? Math.min(start, doc.start) : start,
            end: last ? lineRange(last).end : 1,
          },
          openable: true,
          ...(doc ? { docstring: doc } : {}),
        };
        return withSteps(head, loose, moduleId, scope);
      },
    ),
  );
  edges.push(
    ...callsEdges(nodes),
    ...extendsEdges(statements, ids, scope.call),
  );
  return { language: "typescript", empty: nodes.length === 0, nodes, edges };
}
