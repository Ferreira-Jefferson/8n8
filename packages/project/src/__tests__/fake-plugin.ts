import type {
  FlowEdge,
  FlowNode,
  Graph,
  LanguageAnalysis,
  LanguagePlugin,
  SourceFile,
} from "@8n8/model";

/** A line `def name` becomes a function node; a line `use path` becomes an `imports` wire to that file. */
export function fileGraph(file: SourceFile, id: string): Graph {
  const lines = file.source.split("\n");
  const last = Math.max(1, lines.length - (file.source.endsWith("\n") ? 1 : 0));
  const dir = file.path.split("/").slice(0, -1).join("/");
  const head: FlowNode = {
    id: `file:${file.path}`,
    kind: "file",
    label: file.path.split("/").pop() ?? file.path,
    parentId: dir === "" ? null : `dir:${dir}`,
    range: { start: 1, end: last },
    openable: true,
    path: file.path,
  };
  const inner: FlowNode[] = [];
  lines.forEach((text, i) => {
    const name = /^def (\w+)/.exec(text)?.[1];
    if (name === undefined) return;
    inner.push({
      id: `${head.id}/fn:${name}`,
      kind: "function",
      label: name,
      parentId: head.id,
      range: { start: i + 1, end: i + 1 },
      openable: true,
    });
  });
  return { language: id, empty: false, nodes: [head, ...inner], edges: [] };
}

export function importsOf(files: SourceFile[]): FlowEdge[] {
  return files.flatMap((f) =>
    f.source
      .split("\n")
      .flatMap((t) => /^use (\S+)/.exec(t)?.[1] ?? [])
      .map((target) => ({
        id: `imports:file:${f.path}->file:${target}`,
        kind: "imports" as const,
        source: `file:${f.path}`,
        target: `file:${target}`,
      })),
  );
}

export interface FakeOptions {
  /** Changes what `analyze` returns, to model a plugin with a bug. */
  tweak?: (analysis: LanguageAnalysis, files: SourceFile[]) => LanguageAnalysis;
  /** Throws from `analyze` when it returns true. */
  throwsOn?: (files: SourceFile[]) => boolean;
  /** Records the files each `analyze` call receives. */
  calls?: SourceFile[][];
}

export function fakePlugin(
  id: string,
  extensions: string[],
  options: FakeOptions = {},
): LanguagePlugin {
  return {
    id,
    label: id,
    extensions,
    ignoredDirs: [],
    commentPrefix: "#",
    detect: () => 0,
    extract: (source) => fileGraph({ path: "x", source }, id),
    analyze(files) {
      options.calls?.push(files);
      if (options.throwsOn?.(files)) throw new Error("parser exploded");
      const analysis: LanguageAnalysis = {
        files: files.map((f) => ({ path: f.path, graph: fileGraph(f, id) })),
        imports: importsOf(files),
        offers: [],
        requests: [],
      };
      return options.tweak ? options.tweak(analysis, files) : analysis;
    },
  };
}
