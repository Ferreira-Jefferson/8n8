import {
  childId,
  type FlowEdge,
  type FlowNode,
  type Graph,
  type NodeId,
  topLevelId,
} from "@code2n8n/model";
import type { Node, Tree } from "web-tree-sitter";
import type { CallContext } from "./calls";
import { importAliases } from "./imports";
import { buildSteps, IGNORED, lineRange } from "./steps";

/** A contiguous run of nodes in pre-order, with the wires created inside it. */
interface Chunk {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface Scope {
  call: CallContext;
  names: Map<NodeId, string>;
}

/** The `def` or `class` behind an optional decorator, or null. */
function definitionOf(node: Node): Node | null {
  const def =
    node.type === "decorated_definition"
      ? node.childForFieldName("definition")
      : node;
  if (def?.type === "function_definition" || def?.type === "class_definition") {
    return def;
  }
  return null;
}

function nameOf(def: Node): string {
  return def.childForFieldName("name")?.text ?? "";
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

function bodyOf(def: Node): Node[] {
  return def.childForFieldName("body")?.namedChildren ?? [];
}

/** `head` (if any) followed by the steps of `body` under `parentId`. */
function withSteps(
  head: FlowNode | null,
  body: Node[],
  parentId: NodeId,
  scope: Scope,
): Chunk {
  const chunk: Chunk = { nodes: head ? [head] : [], edges: [] };
  buildSteps(body, parentId, { ...scope, ...chunk });
  return chunk;
}

/**
 * Lays out definitions in code order. The loose statements form one chunk,
 * placed where the first of them appears.
 */
function layout(
  statements: Node[],
  onDefinition: (def: Node, outer: Node, index: number) => Chunk,
  onLoose: (loose: Node[]) => Chunk,
): Chunk[] {
  const chunks: Chunk[] = [];
  const loose: Node[] = [];
  let looseAt = -1;
  let defIndex = 0;
  for (const statement of statements) {
    if (IGNORED.has(statement.type)) continue;
    const def = definitionOf(statement);
    if (def === null) {
      if (loose.length === 0) looseAt = chunks.length;
      loose.push(statement);
    } else {
      chunks.push(onDefinition(def, statement, defIndex++));
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
  def: Node,
  outer: Node,
  id: NodeId,
  parentId: NodeId | null,
): FlowNode {
  return {
    id,
    kind: def.type === "class_definition" ? "class" : "function",
    label: nameOf(def),
    parentId,
    range: lineRange(outer),
    openable: true,
  };
}

function buildFunction(
  def: Node,
  outer: Node,
  id: NodeId,
  parentId: NodeId | null,
  scope: Scope,
): Chunk {
  const head = definitionNode(def, outer, id, parentId);
  return withSteps(head, bodyOf(def), id, scope);
}

function buildClass(
  def: Node,
  outer: Node,
  id: NodeId,
  parentId: NodeId | null,
  scope: Scope,
): Chunk {
  const body = bodyOf(def);
  const methodId = idAllocator();
  const ids: NodeId[] = [];
  const methods = new Map<string, NodeId>();
  const names = new Map(scope.names);
  for (const statement of body) {
    const method = definitionOf(statement);
    if (method === null) continue;
    const name = nameOf(method);
    const isMethod = method.type === "function_definition";
    const mid = childId(id, methodId(isMethod ? "function" : "class", name));
    ids.push(mid);
    if (isMethod) methods.set(name, mid);
    names.set(mid, name);
  }
  const inner: Scope = { call: { ...scope.call, methods }, names };

  const children = layout(
    body,
    (method, outer, index) =>
      buildFunction(method, outer, ids[index] ?? "", id, inner),
    (loose) => withSteps(null, loose, id, inner),
  );
  return merge([
    { nodes: [definitionNode(def, outer, id, parentId)], edges: [] },
    ...children,
  ]);
}

const OWNERS = new Set(["function", "class", "module"]);

/** One `calls` wire per (caller, callee) pair, from the `call` steps (CORE-02). */
function callsEdges(nodes: FlowNode[]): FlowEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = new Map<string, FlowEdge>();
  for (const step of nodes) {
    if (step.kind !== "call" || step.target === undefined) continue;
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

export interface TopLevel {
  /** Ids of the top-level definitions, in code order. */
  ids: NodeId[];
  /** Name to id; the last `def` with a name wins, as in Python. */
  topLevel: Map<string, NodeId>;
  names: Map<NodeId, string>;
}

/** Allocates `fn:x`, `fn:x#2`, `cls:X` for the top-level definitions of `root`. */
export function allocateTopLevel(root: Node): TopLevel {
  const topId = idAllocator();
  const ids: NodeId[] = [];
  const topLevel = new Map<string, NodeId>();
  const names = new Map<NodeId, string>();
  for (const statement of root.namedChildren) {
    if (IGNORED.has(statement.type)) continue;
    const def = definitionOf(statement);
    if (def === null) continue;
    const name = nameOf(def);
    const kind = def.type === "class_definition" ? "class" : "function";
    const id = topId(kind, name);
    ids.push(id);
    topLevel.set(name, id);
    names.set(id, name);
  }
  return { ids, topLevel, names };
}

export interface BuildOptions
  extends Pick<CallContext, "resolveImport" | "projectNames"> {
  /** Parent of the top-level nodes, also prefixed to their ids (AD-013). */
  prefix?: NodeId;
}

/** Builds the graph of a parsed snippet (CORE-01, 03, 07, 08). */
export function buildGraph(tree: Tree, options: BuildOptions = {}): Graph {
  const { prefix, ...resolvers } = options;
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
      aliases: importAliases(tree.rootNode),
      ...resolvers,
    },
    names: new Map([...top.names].map(([id, name]) => [scoped(id), name])),
  };
  const moduleId = scoped("mod");

  const { nodes, edges } = merge(
    layout(
      statements,
      (def, outer, index) => {
        const id = ids[index] ?? "";
        return def.type === "class_definition"
          ? buildClass(def, outer, id, parentId, scope)
          : buildFunction(def, outer, id, parentId, scope);
      },
      (loose) => {
        const first = loose[0];
        const last = loose[loose.length - 1];
        const head: FlowNode = {
          id: moduleId,
          kind: "module",
          label: "Módulo",
          parentId,
          range: {
            start: first ? lineRange(first).start : 1,
            end: last ? lineRange(last).end : 1,
          },
          openable: true,
        };
        return withSteps(head, loose, moduleId, scope);
      },
    ),
  );
  edges.push(...callsEdges(nodes));
  return { language: "python", empty: nodes.length === 0, nodes, edges };
}
