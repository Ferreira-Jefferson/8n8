import type { FlowNode, Graph, NodeId } from "@8n8/model";
import { codeLineOf, provisionalLabel, tagLabel, tagOf } from "../flow/card";
import { defaultT, type Translate } from "../i18n";

/** What the search knows about a node: its title, its technical name and where it lives. */
export interface SearchEntry {
  id: NodeId;
  /** The reviewed title, or the provisional name while there is none. */
  title: string;
  /** The name in the code (`cadastro_produto()`), the second line of the card. */
  tech: string;
  /** The right side of a result: file and lines, or the kind for a folder or file. */
  where: string;
}

export interface Part {
  text: string;
  hit: boolean;
}

/** The kinds worth a search: the ones with a name. Calls, steps and returns only repeat them. */
const SEARCHABLE = new Set([
  "folder",
  "file",
  "function",
  "class",
  "loop",
  "block",
]);

/** Most results shown at once. */
export const MAX_RESULTS = 50;

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

/** The entries that hold every word in the title or in the technical name, in order. */
export function matchEntries(
  entries: readonly SearchEntry[],
  query: string,
  limit = MAX_RESULTS,
): SearchEntry[] {
  const words = searchWords(query);
  const out: SearchEntry[] = [];
  for (const e of entries) {
    const hay = fold(`${e.title} ${e.tech}`);
    if (words.every((w) => hay.includes(w))) out.push(e);
    if (out.length === limit) break;
  }
  return out;
}

/** Splits `text` into the stretches the `words` hit and the ones they miss. */
export function highlight(text: string, words: readonly string[]): Part[] {
  const folded = fold(text);
  const hit = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (
      let at = folded.indexOf(w);
      at !== -1;
      at = folded.indexOf(w, at + 1)
    ) {
      hit.fill(true, at, at + w.length);
    }
  }
  const parts: Part[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts.at(-1);
    const h = hit[i] === true;
    if (last && last.hit === h) last.text += text[i];
    else parts.push({ text: text[i] ?? "", hit: h });
  }
  return parts;
}

const lines = (n: FlowNode) =>
  n.range.start === n.range.end
    ? `${n.range.start}`
    : `${n.range.start}–${n.range.end}`;

/** An entry for each searchable node of the whole graph, at every level. */
export function searchEntries(
  graph: Graph,
  titles: ReadonlyMap<NodeId, string>,
  t: Translate = defaultT,
): SearchEntry[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const fileOf = (n: FlowNode): FlowNode | undefined => {
    let node: FlowNode | undefined = n;
    while (node && node.kind !== "file") {
      node = node.parentId === null ? undefined : byId.get(node.parentId);
    }
    return node;
  };
  return graph.nodes
    .filter((n) => SEARCHABLE.has(n.kind))
    .map((n) => {
      const container = n.kind === "folder" || n.kind === "file";
      const file = container ? undefined : fileOf(n)?.path;
      return {
        id: n.id,
        title: titles.get(n.id) ?? provisionalLabel(n, t),
        tech: codeLineOf(n, ""),
        where: container
          ? tagLabel(tagOf(n), t)
          : [file?.split("/").at(-1), lines(n)].filter(Boolean).join(" · "),
      };
    });
}
