import type { FlowNode } from "./graph";

/** The kinds worth a search: the ones with a name. Calls, steps and returns only repeat them. */
export const SEARCHABLE_KINDS: ReadonlySet<FlowNode["kind"]> = new Set([
  "folder",
  "file",
  "function",
  "class",
  "loop",
  "block",
]);

/**
 * Lowercase, no accents, and `_`, `-` and blanks as one space. It keeps the
 * length, so a match in the folded text points at the same place in the original.
 */
export function fold(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = (text[i] ?? "").normalize("NFD").toLowerCase().charAt(0);
    out += c === "" ? (text[i] ?? "") : /[\s_-]/.test(c) ? " " : c;
  }
  return out;
}

/** The words of a query, folded; none for a blank query. */
export function searchWords(query: string): string[] {
  return fold(query).split(" ").filter(Boolean);
}

/**
 * The folded text the search reads in a node with no reviewed title: its
 * provisional name and its technical name, as the screen shows them. Only for
 * `SEARCHABLE_KINDS`; the words of the system never come into it.
 */
export function searchText(node: FlowNode): string {
  switch (node.kind) {
    case "function":
    case "class": {
      const provisional = (node.label.split(".").at(-1) ?? "").replaceAll(
        "_",
        " ",
      );
      return fold(`${provisional} ${node.label}()`);
    }
    case "folder":
      return fold(`${node.label} ${node.path ?? ""}/`);
    case "file":
      return fold(`${node.label} ${node.path ?? node.label}`);
    default:
      return fold(`${node.label} ${node.label}`);
  }
}
