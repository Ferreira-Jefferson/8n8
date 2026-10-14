import type { Node } from "web-tree-sitter";

/** What a local name got from an import (or a `require`). */
export interface Binding {
  /** The specifier, as written: `./x`, `node:fs`, `axios`. */
  module: string;
  /** The exported name for `named`; null for `default` and `namespace`. */
  imported: string | null;
  kind: "named" | "default" | "namespace";
}

/** The text of a string literal, or of a template without substitutions. */
export function stringValue(node: Node | null): string | null {
  if (node?.type === "string") return node.text.slice(1, -1);
  if (node?.type === "template_string" && !node.text.includes("${")) {
    return node.text.slice(1, -1);
  }
  return null;
}

/** The arguments of a call, comments left out. */
export function argumentsOf(call: Node): Node[] {
  return (
    call
      .childForFieldName("arguments")
      ?.namedChildren.filter((c) => c.type !== "comment") ?? []
  );
}

/** The specifier of `require("x")`, or null when the node is anything else. */
export function requireSource(node: Node | null): string | null {
  if (node?.type !== "call_expression") return null;
  const fn = node.childForFieldName("function");
  if (fn?.type !== "identifier" || fn.text !== "require") return null;
  return stringValue(argumentsOf(node)[0] ?? null);
}

/** `const a = require("x")`, alone in its statement: it works as an import. */
export function isRequireDeclaration(node: Node): boolean {
  if (
    node.type !== "lexical_declaration" &&
    node.type !== "variable_declaration"
  )
    return false;
  const declarators = node.namedChildren.filter(
    (c) => c.type === "variable_declarator",
  );
  return (
    declarators.length > 0 &&
    declarators.every(
      (d) => requireSource(d.childForFieldName("value")) !== null,
    )
  );
}

function addImport(
  out: Map<string, Binding>,
  statement: Node,
  module: string,
): void {
  const clause = statement.namedChildren.find(
    (c) => c.type === "import_clause",
  );
  for (const child of clause?.namedChildren ?? []) {
    if (child.type === "identifier") {
      out.set(child.text, { module, imported: null, kind: "default" });
    } else if (child.type === "namespace_import") {
      const local = child.namedChildren[0]?.text;
      if (local) out.set(local, { module, imported: null, kind: "namespace" });
    } else if (child.type === "named_imports") {
      for (const spec of child.namedChildren) {
        const name = spec.childForFieldName("name")?.text;
        if (name === undefined) continue;
        const local = spec.childForFieldName("alias")?.text ?? name;
        out.set(local, { module, imported: name, kind: "named" });
      }
    }
  }
}

/** `const { a, b: c } = require("x")` binds `a` and `c` as named imports. */
function addRequire(
  out: Map<string, Binding>,
  declarator: Node,
  module: string,
): void {
  const name = declarator.childForFieldName("name");
  if (name?.type === "identifier") {
    out.set(name.text, { module, imported: null, kind: "namespace" });
  } else if (name?.type === "object_pattern") {
    for (const prop of name.namedChildren) {
      if (prop.type === "shorthand_property_identifier_pattern") {
        out.set(prop.text, { module, imported: prop.text, kind: "named" });
      } else if (prop.type === "pair_pattern") {
        const key = prop.childForFieldName("key")?.text;
        const local = prop.childForFieldName("value");
        if (key && local?.type === "identifier") {
          out.set(local.text, { module, imported: key, kind: "named" });
        }
      }
    }
  }
}

/** Maps each local name bound by an import or a `require`, anywhere in the tree. */
export function importBindings(root: Node): Map<string, Binding> {
  const out = new Map<string, Binding>();
  for (const node of root.descendantsOfType([
    "import_statement",
    "variable_declarator",
  ])) {
    if (node.type === "import_statement") {
      const module = stringValue(node.childForFieldName("source"));
      if (module !== null) addImport(out, node, module);
    } else {
      const module = requireSource(node.childForFieldName("value"));
      if (module !== null) addRequire(out, node, module);
    }
  }
  return out;
}

/**
 * Every module specifier the tree loads, in code order: `import`,
 * `export ... from`, `require("x")` and `import("x")`.
 */
export function moduleSpecifiers(root: Node): string[] {
  const nodes = root
    .descendantsOfType([
      "import_statement",
      "export_statement",
      "call_expression",
    ])
    .sort((a, b) => a.startIndex - b.startIndex);
  const out: string[] = [];
  for (const node of nodes) {
    let source: string | null = null;
    if (node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      if (fn?.type === "import")
        source = stringValue(argumentsOf(node)[0] ?? null);
      else source = requireSource(node);
    } else {
      source = stringValue(node.childForFieldName("source"));
    }
    if (source !== null) out.push(source);
  }
  return out;
}
