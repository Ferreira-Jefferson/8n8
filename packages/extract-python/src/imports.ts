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
