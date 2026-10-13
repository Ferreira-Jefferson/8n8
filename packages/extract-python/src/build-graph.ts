import {
  childId,
  type FlowNode,
  type Graph,
  type LineRange,
  type NodeId,
  topLevelId,
} from "@code2n8n/model";
import type { Node, Tree } from "web-tree-sitter";

/** Statements that never become steps and never create the module node. */
const IGNORED = new Set([
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

function buildClass(def: Node, outer: Node, id: NodeId): FlowNode[] {
  const nodes = [definitionNode(def, outer, id, null)];
  const methodId = idAllocator();
  for (const statement of bodyOf(def)) {
    const method = definitionOf(statement);
    if (method?.type === "function_definition") {
      const mid = childId(id, methodId("function", nameOf(method)));
      nodes.push(definitionNode(method, statement, mid, id));
    }
  }
  return nodes;
}

/** Builds the graph of a parsed snippet: top-level nodes first (CORE-01, 03, 07). */
export function buildGraph(tree: Tree): Graph {
  const chunks: FlowNode[][] = [];
  const loose: Node[] = [];
  let moduleAt = -1;
  const topId = idAllocator();

  for (const statement of tree.rootNode.namedChildren) {
    if (IGNORED.has(statement.type)) continue;
    const def = definitionOf(statement);
    if (def === null) {
      if (loose.length === 0) moduleAt = chunks.length;
      loose.push(statement);
    } else if (def.type === "class_definition") {
      chunks.push(buildClass(def, statement, topId("class", nameOf(def))));
    } else {
      const id = topId("function", nameOf(def));
      chunks.push([definitionNode(def, statement, id, null)]);
    }
  }

  const first = loose[0];
  const last = loose[loose.length - 1];
  if (first && last) {
    chunks.splice(moduleAt, 0, [
      {
        id: "mod",
        kind: "module",
        label: "Módulo",
        parentId: null,
        range: {
          start: lineRange(first).start,
          end: lineRange(last).end,
        },
        openable: true,
      },
    ]);
  }

  const nodes = chunks.flat();
  return { language: "python", empty: nodes.length === 0, nodes, edges: [] };
}
