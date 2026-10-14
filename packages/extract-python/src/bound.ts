import type { Node } from "web-tree-sitter";

/** Nodes that group several targets, such as `a, (b, *c)`. */
const GROUPS = new Set([
  "pattern_list",
  "tuple_pattern",
  "list_pattern",
  "list_splat_pattern",
  "dictionary_splat_pattern",
  "tuple",
  "list",
  "parenthesized_expression",
  "expression_list",
  "as_pattern_target",
]);

/** Adds the names of a target; `obj.x` and `d[k]` bind no name. */
function addTarget(node: Node | null, out: Set<string>): void {
  if (!node) return;
  if (node.type === "identifier") out.add(node.text);
  else if (GROUPS.has(node.type)) {
    for (const child of node.namedChildren) addTarget(child, out);
  }
}

/** `a`, `a=1`, `a: int`, `a: int = 1`, `*args`, `**kw`. */
function addParameters(node: Node | null, out: Set<string>): void {
  for (const parameter of node?.namedChildren ?? []) {
    const name =
      parameter.childForFieldName("name") ??
      (parameter.type === "typed_parameter"
        ? parameter.namedChildren[0]
        : parameter);
    addTarget(name ?? null, out);
  }
}

/**
 * Every name the file binds anywhere, without looking at scope (VID-13):
 * parameters, assignment and loop targets, names after `as`, `:=`, `def`,
 * `class`, `global` and `nonlocal`.
 */
export function boundNames(root: Node): Set<string> {
  const out = new Set<string>();
  const nodes = root.descendantsOfType([
    "function_definition",
    "class_definition",
    "lambda",
    "assignment",
    "augmented_assignment",
    "for_statement",
    "for_in_clause",
    "as_pattern",
    "aliased_import",
    "named_expression",
    "global_statement",
    "nonlocal_statement",
  ]);
  for (const node of nodes) {
    switch (node.type) {
      case "function_definition":
      case "lambda":
        addTarget(node.childForFieldName("name"), out);
        addParameters(node.childForFieldName("parameters"), out);
        break;
      case "class_definition":
      case "named_expression":
        addTarget(node.childForFieldName("name"), out);
        break;
      case "as_pattern":
      case "aliased_import":
        addTarget(node.childForFieldName("alias"), out);
        break;
      case "global_statement":
      case "nonlocal_statement":
        for (const name of node.namedChildren) addTarget(name, out);
        break;
      default:
        addTarget(node.childForFieldName("left"), out);
    }
  }
  return out;
}
