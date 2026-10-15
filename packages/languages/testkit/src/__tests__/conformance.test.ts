import type { FlowNode, Graph, LanguagePlugin } from "@8n8/model";
import { describeLanguagePlugin } from "../index";

/** A line `def name` is a function; the whole file is a `file` node. */
function graphOf(path: string, source: string): Graph {
  const lines = source.split("\n");
  const last = Math.max(1, lines.length - (source.endsWith("\n") ? 1 : 0));
  const dir = path.split("/").slice(0, -1).join("/");
  const id = `file:${path}`;
  const head: FlowNode = {
    id,
    kind: "file",
    label: path,
    parentId: dir === "" ? null : `dir:${dir}`,
    range: { start: 1, end: last },
    openable: true,
    path,
  };
  const inner: FlowNode[] = lines.flatMap((text, i) => {
    const name = /^def (\w+)/.exec(text)?.[1];
    return name === undefined
      ? []
      : [
          {
            id: `${id}/fn:${name}`,
            kind: "function" as const,
            label: name,
            parentId: id,
            range: { start: i + 1, end: i + 1 },
            openable: true,
          },
        ];
  });
  return { language: "mini", empty: false, nodes: [head, ...inner], edges: [] };
}

const mini: LanguagePlugin = {
  id: "mini",
  label: "Mini",
  extensions: [".mini"],
  ignoredDirs: ["cache"],
  commentPrefix: "--",
  detect: (source) => (source.includes("def ") ? 0.9 : 0),
  extract: (source) => {
    const g = graphOf("snippet", source);
    return {
      ...g,
      nodes: g.nodes.slice(1).map((n) => ({
        ...n,
        id: n.id.replace("file:snippet/", ""),
        parentId: null,
      })),
      empty: g.nodes.length === 1,
    };
  },
  analyze: (files) => ({
    files: files.map((f) => ({
      path: f.path,
      graph: graphOf(f.path, f.source),
    })),
    imports: [],
    offers: [],
    requests: [],
  }),
};

describeLanguagePlugin(mini, {
  snippets: ["def a\ndef b\n", "", "x"],
  files: [
    { path: "a.mini", source: "def a\ndef b\n" },
    { path: "pkg/b.mini", source: "def c\n" },
  ],
});
