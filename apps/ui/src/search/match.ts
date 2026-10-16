import {
  type FlowNode,
  fold,
  type Graph,
  type NodeId,
  SEARCHABLE_KINDS,
  searchWords,
} from "@8n8/model";
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
  /** Only on a hit of the server: the parents of a node whose file may not be loaded yet, from the top. */
  ancestry?: NodeId[];
}

export interface Part {
  text: string;
  hit: boolean;
}

/** Most results shown at once. */
export const MAX_RESULTS = 50;

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

/** The entry of one searchable node; `file` is the path of the file it lives in, none for a folder or a file. */
export function searchEntryOf(
  node: FlowNode,
  file: string | undefined,
  title: string | undefined,
  t: Translate = defaultT,
): SearchEntry {
  const container = node.kind === "folder" || node.kind === "file";
  return {
    id: node.id,
    title: title ?? provisionalLabel(node, t),
    tech: codeLineOf(node, ""),
    where: container
      ? tagLabel(tagOf(node), t)
      : [file?.split("/").at(-1), lines(node)].filter(Boolean).join(" · "),
  };
}

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
    .filter((n) => SEARCHABLE_KINDS.has(n.kind))
    .map((n) => searchEntryOf(n, fileOf(n)?.path, titles.get(n.id), t));
}

/**
 * The hits of the server, in its order, with the entry of the screen where it has one
 * (it carries the reviewed title); then, first, the matches only the screen found,
 * by a title. At most `limit`.
 */
export function mergeResults(
  local: readonly SearchEntry[],
  remote: readonly SearchEntry[],
  limit = MAX_RESULTS,
): SearchEntry[] {
  const known = new Map(local.map((e) => [e.id, e]));
  const heard = new Set(remote.map((e) => e.id));
  const merged = [
    ...local.filter((e) => !heard.has(e.id)),
    ...remote.map((e) => ({
      ...(known.get(e.id) ?? e),
      ...(e.ancestry ? { ancestry: e.ancestry } : {}),
    })),
  ];
  return merged.slice(0, limit);
}
