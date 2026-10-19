import type { Node } from "web-tree-sitter";

/** Maps each local name bound by an import, anywhere in the tree, to its full name. */
export function importAliases(root: Node): Map<string, string> {
  const aliases = new Map<string, string>();
  const statements = root.descendantsOfType([
    "import_statement",
    "import_from_statement",
  ]);
  for (const statement of statements) {
    const module = statement.childForFieldName("module_name")?.text;
    for (const name of statement.childrenForFieldName("name")) {
      const full = name.childForFieldName("name")?.text ?? name.text;
      const alias = name.childForFieldName("alias")?.text;
      if (module !== undefined) {
        const joiner = module.endsWith(".") ? "" : ".";
        aliases.set(alias ?? full, `${module}${joiner}${full}`);
      } else if (alias !== undefined) {
        aliases.set(alias, full);
      } else {
        const head = full.split(".")[0] ?? full;
        aliases.set(head, head);
      }
    }
  }
  return aliases;
}

/** The modules of each `from x import *`, as written (`utils`, `.sibling`). */
export function starModules(root: Node): string[] {
  return root
    .descendantsOfType("import_from_statement")
    .filter((s) => s.namedChildren.some((c) => c.type === "wildcard_import"))
    .flatMap((s) => s.childForFieldName("module_name")?.text ?? []);
}

/** The names of a top-level `__all__ = ["a", "b"]`; null without one, or when it is not a plain list of strings. */
export function allNames(root: Node): string[] | null {
  let names: string[] | null = null;
  for (const statement of root.namedChildren) {
    const assignment = statement.namedChildren[0];
    if (
      statement.type !== "expression_statement" ||
      assignment?.type !== "assignment" ||
      assignment.childForFieldName("left")?.text !== "__all__"
    ) {
      continue;
    }
    const value = assignment.childForFieldName("right");
    const items =
      value?.type === "list" || value?.type === "tuple"
        ? value.namedChildren.map((item) => /^(["'])(\w+)\1$/.exec(item.text))
        : [null];
    names = items.every((m) => m !== null)
      ? items.map((m) => m?.[2] ?? "")
      : null;
  }
  return names;
}
