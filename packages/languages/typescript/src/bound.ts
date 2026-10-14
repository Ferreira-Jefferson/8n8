import type { Node } from "web-tree-sitter";

/**
 * Names that are always there and never count as an external step: pure
 * data built-ins, and the keywords that look like names.
 */
export const BUILTINS = [
  "this",
  "super",
  "arguments",
  "undefined",
  "require",
  "Math",
  "JSON",
  "Object",
  "Array",
  "Number",
  "String",
  "Boolean",
  "BigInt",
  "Symbol",
  "Promise",
  "Date",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "RegExp",
  "Error",
  "TypeError",
  "RangeError",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURIComponent",
  "decodeURIComponent",
  "encodeURI",
  "decodeURI",
];

/** Nodes that group several targets, such as `{ a, b: [c] }`. */
const GROUPS = new Set(["object_pattern", "array_pattern", "rest_pattern"]);

/** Adds the names of a target; `obj.x` and `a[k]` bind no name. */
function addTarget(node: Node | null, out: Set<string>): void {
  if (!node) return;
  switch (node.type) {
    case "identifier":
    case "shorthand_property_identifier_pattern":
      out.add(node.text);
      break;
    case "pair_pattern":
      addTarget(node.childForFieldName("value"), out);
      break;
    case "assignment_pattern":
    case "object_assignment_pattern":
      addTarget(node.childForFieldName("left"), out);
      break;
    default:
      if (GROUPS.has(node.type)) {
        for (const child of node.namedChildren) addTarget(child, out);
      }
  }
}

/**
 * Every name the file binds anywhere, without looking at scope: variables,
 * parameters, functions, classes, enums, namespaces, catch and loop
 * variables, and import names. Plus the built-ins.
 */
export function boundNames(root: Node): Set<string> {
  const out = new Set<string>(BUILTINS);
  const nodes = root.descendantsOfType([
    "variable_declarator",
    "function_declaration",
    "generator_function_declaration",
    "function_expression",
    "class_declaration",
    "abstract_class_declaration",
    "enum_declaration",
    "internal_module",
    "required_parameter",
    "optional_parameter",
    "arrow_function",
    "catch_clause",
    "for_in_statement",
    "import_clause",
    "import_specifier",
    "namespace_import",
  ]);
  for (const node of nodes) {
    switch (node.type) {
      case "required_parameter":
      case "optional_parameter":
        addTarget(node.childForFieldName("pattern"), out);
        break;
      case "arrow_function":
        // `x => x` has a bare `parameter`.
        addTarget(node.childForFieldName("parameter"), out);
        break;
      case "catch_clause":
        addTarget(node.childForFieldName("parameter"), out);
        break;
      case "for_in_statement":
        addTarget(node.childForFieldName("left"), out);
        break;
      case "import_clause":
        for (const child of node.namedChildren) {
          if (child.type === "identifier") out.add(child.text);
        }
        break;
      case "import_specifier":
        addTarget(
          node.childForFieldName("alias") ?? node.childForFieldName("name"),
          out,
        );
        break;
      case "namespace_import":
        addTarget(node.namedChildren[0] ?? null, out);
        break;
      default:
        addTarget(node.childForFieldName("name"), out);
    }
  }
  return out;
}
