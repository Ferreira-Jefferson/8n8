import { linkProject } from "@8n8/links";
import type {
  Graph,
  IgnoredFile,
  LanguagePlugin,
  SourceFile,
} from "@8n8/model";
import { analyzeProject, type ProjectBuild } from "@8n8/project";
import { type CompactInput, compactProject } from "./project-compact";
import type { StoreParts } from "./project-store";

/** What a build needs: the files the reader gave, and the names that go on the result. */
export interface BuildInput {
  name: string;
  files: SourceFile[];
  ignored: IgnoredFile[];
  /** Names this build (the reader's fingerprint of the files). */
  version: string;
}

/** Makes the store parts of a project; in the thread of the request, or in a worker thread with the same answer. */
export type Build = (
  input: BuildInput,
  plugins: LanguagePlugin[],
) => Promise<StoreParts>;

/** Wires between languages (D3, D4); the nodes stay as the plugins made them. The project sets `graph.project` (PROJ-01, PROJ-05, PROJ-06, PROJ-07). */
export function linkedGraph(
  { graph: built, offers, requests }: ProjectBuild,
  name: string,
): Graph {
  const { edges: links } = linkProject({
    offers,
    requests,
    nodes: built.nodes,
  });
  const known = new Set(built.edges.map((e) => e.id));
  return {
    ...built,
    edges: [...built.edges, ...links.filter((e) => !known.has(e.id))],
    project: { name },
  };
}

/**
 * The store parts of a project from the analysis of its files: link, pack. `analyze` runs the plugins, in this
 * thread or in workers; `compact` packs the linked graph (the sync `compactProject` unless the caller says otherwise).
 */
export async function buildWith(
  input: BuildInput,
  plugins: LanguagePlugin[],
  analyze: (
    files: SourceFile[],
    plugins: LanguagePlugin[],
  ) => ProjectBuild | Promise<ProjectBuild>,
  compact: (
    input: CompactInput,
  ) => StoreParts | Promise<StoreParts> = compactProject,
): Promise<StoreParts> {
  const built = await analyze(input.files, plugins);
  return compact({ ...input, graph: linkedGraph(built, input.name) });
}

/** The plugins run in this thread. */
export const buildInThread: Build = (input, plugins) =>
  buildWith(input, plugins, analyzeProject);
