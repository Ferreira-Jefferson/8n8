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
  dottedName,
  memberOf as importedMember,
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

function buildClass(
  def: Definition,
  id: NodeId,
  parentId: NodeId | null,
  scope: Scope,
): Chunk {
  const body = def.node.childForFieldName("body")?.namedChildren ?? [];
  const methodId = idAllocator();
  const ids: NodeId[] = [];
  const methods = new Map<string, NodeId>();
  const names = new Map(scope.names);
  for (const member of body) {
    const method = memberOf(member);
    if (method === null) continue;
    const mid = childId(id, methodId("function", method.name));
    ids.push(mid);
    methods.set(method.name, mid);
    names.set(mid, method.name);
  }
  const inner: Scope = { call: { ...scope.call, methods }, names };

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

/** Whether the id names a class: its last segment is `cls:X`. */
function isClassId(id: NodeId): boolean {
  return (id.split("/").pop() ?? "").startsWith("cls:");
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

/** The class a base name refers to: this snippet's, or a project class by import. */
function baseTarget(name: string, ctx: CallContext): NodeId | null {
  const local = ctx.topLevel.get(name);
  if (local !== undefined) return local;
  const [head = name, ...rest] = name.split(".");
  const binding = ctx.aliases.get(head);
  if (binding === undefined) return null;
  const member = importedMember(binding, rest);
  return member === null
    ? null
    : (ctx.resolveImport?.(binding, member) ?? null);
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
    const base = def.kind === "class" ? baseOf(def.node) : null;
    const name = base === null ? null : dottedName(base);
    const target = name === null ? null : baseTarget(name, ctx);
    if (target === null || target === source || !isClassId(target)) continue;
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
}

/** Allocates `fn:x`, `fn:x#2`, `cls:X` for the top-level definitions of `root`. */
export function allocateTopLevel(root: Node): TopLevel {
  const topId = idAllocator();
  const ids: NodeId[] = [];
  const topLevel = new Map<string, NodeId>();
  const names = new Map<NodeId, string>();
  for (const statement of root.namedChildren) {
    if (isIgnored(statement)) continue;
    const def = definitionOf(statement);
    if (def === null) continue;
    const id = topId(def.kind, def.name);
    ids.push(id);
    topLevel.set(def.name, id);
    names.set(id, def.name);
  }
  return { ids, topLevel, names };
}

export interface BuildOptions {
  /** Parent of the top-level nodes, also prefixed to their ids. */
  prefix?: NodeId;
  resolveImport?: CallContext["resolveImport"];
}

/** Builds the graph of a parsed snippet or file. */
export function buildGraph(tree: Tree, options: BuildOptions = {}): Graph {
  const { prefix, resolveImport } = options;
  const scoped = (id: NodeId) =>
    prefix === undefined ? id : childId(prefix, id);
  const parentId = prefix ?? null;
  const statements = tree.rootNode.namedChildren;
  const top = allocateTopLevel(tree.rootNode);
  const ids = top.ids.map(scoped);
  const scope: Scope = {
    call: {
      topLevel: new Map(
        [...top.topLevel].map(([name, id]) => [name, scoped(id)]),
      ),
      methods: new Map(),
      aliases: importBindings(tree.rootNode),
      bound: boundNames(tree.rootNode),
      ...(resolveImport === undefined ? {} : { resolveImport }),
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
