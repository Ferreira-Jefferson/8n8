import type { LanguagePlugin, SourceFile } from "@8n8/model";
import { analyzeProject } from "@8n8/project";
import { createProjectStore, type StoreParts } from "../project-store";
import { compactProject, linkedGraph } from "./reference-compact";

const QUERIES = ["", "a", "py", "ts", "app", "frete", "calcular()", "pedido"];

/** Everything a store answers for its project, to compare two stores of the same project: the files, the nodes, the calls, the search, the skeleton. */
export function answers(parts: StoreParts) {
  const store = createProjectStore(parts);
  const nodes = [
    ...parts.folders,
    ...store.paths.flatMap((p) => store.detailOf(p)?.nodes ?? []),
  ].sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    name: store.name,
    version: store.version,
    empty: store.empty,
    counts: store.counts,
    skeleton: store.skeleton,
    paths: [...store.paths].sort(),
    details: [...store.paths].sort().map((p) => store.detailOf(p)),
    nodes: nodes.map((n) => store.nodeOf(n.id)),
    filePaths: nodes.map((n) => store.filePathOf(n.id)),
    calls: nodes.map((n) => store.callsOf(n.id)),
    docstrings: [...store.paths].sort().map((p) => store.docstringsOf(p)),
    search: QUERIES.map((q) => store.search(q, 50)),
    cross: parts.cross,
    searchTexts: parts.search.texts,
    hashes: [...parts.files].map((f) => [f.path, f.hash]).sort(),
  };
}

/** What the server would keep if it had the whole graph in hand and packed it the plain way. */
export function referenceParts(
  name: string,
  files: SourceFile[],
  plugins: LanguagePlugin[],
): StoreParts {
  return compactProject({
    name,
    files,
    ignored: [],
    version: "v-test",
    graph: linkedGraph(analyzeProject(files, plugins), name),
  });
}
