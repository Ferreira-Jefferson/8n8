import {
  type ExplainRequest,
  type ExplainResponse,
  type FlowNode,
  fileNodeOf,
  type Graph,
  type GraphResponse,
  type HistoryEntry,
  type LanguagePlugin,
  type LanguagesResponse,
  type ProjectResponse,
  type TitleItem,
  type TitleRequest,
  type TitlesResponse,
} from "@8n8/model";
import { detectLanguage, pluginForPath } from "@8n8/project";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { maskDocstring } from "./docstring";
import type { History } from "./history";

export type ProjectRead =
  | { kind: "ok"; root: string; response: ProjectResponse }
  | { kind: "not-found" };

export interface AppDeps {
  /** The registered languages, in a stable order: a snippet is read by the best score, a file by its extension. */
  plugins: LanguagePlugin[];
  explain: (req: ExplainRequest) => Promise<ExplainResponse>;
  titles: (req: TitleRequest) => Promise<TitlesResponse>;
  readProject: (path: string) => Promise<ProjectRead>;
  port: number;
  /** Saved searches; absent in tests that do not need them. */
  history?: History | undefined;
}

const projectBody = z.object({ path: z.string().min(1) });
const graphBody = z.object({ source: z.string() });
const starBody = z.object({ starred: z.boolean() });
// Extra fields from the client (code, calls...) are dropped: the server builds the request (CORE-17).
const projectExplainBody = z.object({
  root: z.string().min(1),
  nodeId: z.string(),
});
const explainBody = z.object({ source: z.string(), nodeId: z.string() });
const nodeIds = z.array(z.string()).max(200);
const projectTitlesBody = z.object({ root: z.string().min(1), nodeIds });
const titlesBody = z.object({ source: z.string(), nodeIds });

/** The graph a request talks about, re-extracted on the server (AD-015). */
interface Origin {
  graph: Graph;
  /** The code of `node`, with its docstring masked when it has one. */
  codeOf: (node: FlowNode) => Pick<ExplainRequest, "code" | "docstring">;
  /** The name of `node` as seen from `home`. */
  nameOf: (node: FlowNode, home: FlowNode) => string;
  /** The language of `node`: the detected one in a snippet, the one of its file in a project. */
  pluginOf: (node: FlowNode) => LanguagePlugin;
  /** `<POSIX root>|` in a project, `<languageId>|` in a snippet: the cache never mixes two languages. */
  idPrefix: string;
}

/** Reads `{ source }` or `{ root }`; a missing folder gives `{ notFound }`. The client sends no code (AD-015). */
async function loadOrigin(
  body: { source: string } | { root: string },
  deps: AppDeps,
): Promise<Origin | { notFound: string }> {
  if ("source" in body) {
    const { source } = body;
    const { plugin } = detectLanguage(source, deps.plugins);
    return {
      graph: plugin.extract(source),
      codeOf: (node) =>
        maskDocstring(
          node.range,
          node.docstring,
          source.split(/\r?\n/),
          plugin.commentPrefix,
        ),
      nameOf: (node) => node.label,
      pluginOf: () => plugin,
      idPrefix: `${plugin.id}|`,
    };
  }
  const read = await deps.readProject(body.root);
  if (read.kind === "not-found") return { notFound: body.root };
  const { response } = read;
  const graph = response.graph;
  const filePath = (node: FlowNode) => fileNodeOf(graph, node.id)?.path ?? "";
  // A file is read by its extension, so every node has the plugin of its file.
  const pluginOf = (node: FlowNode) => {
    const plugin = pluginForPath(filePath(node), deps.plugins);
    if (!plugin) throw new Error(`no language plugin for ${filePath(node)}`);
    return plugin;
  };
  return {
    graph,
    codeOf: (node) => {
      const path = filePath(node);
      const file = response.files.find((f) => f.path === path);
      return maskDocstring(
        node.range,
        node.docstring,
        (file?.source ?? "").split(/\r?\n/),
        pluginOf(node).commentPrefix,
      );
    },
    pluginOf,
    // A neighbour from another file is named `<path>:<label>`.
    nameOf: (node, home) =>
      filePath(node) !== filePath(home)
        ? `${filePath(node)}:${node.label}`
        : node.label,
    idPrefix: `${read.root.replaceAll("\\", "/")}|`,
  };
}

/** calls: targets of the outgoing `calls` wires plus `node.target`, once each; calledBy: sources of the incoming `calls` wires. */
function neighboursOf(
  graph: Graph,
  node: FlowNode,
  nameOf: (other: FlowNode) => string,
): { calls: string[]; calledBy: string[] } {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const names = (ids: string[]) =>
    ids.flatMap((id) => {
      const other = byId.get(id);
      return other ? [nameOf(other)] : [];
    });
  const wires = graph.edges.filter((e) => e.kind === "calls");
  const out = wires.filter((e) => e.source === node.id).map((e) => e.target);
  if (node.target) out.push(node.target);
  return {
    calls: names([...new Set(out)]),
    calledBy: names(
      wires.filter((e) => e.target === node.id).map((e) => e.source),
    ),
  };
}

/** A parser or plugin that throws is an answer, not a crash: 500 with a JSON body the screen can show. */
function extractFailed(c: Context, err: unknown): Response {
  console.error("servidor: o extrator falhou", err);
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: "extract-failed", message }, 500);
}

/** Saves a map after the response is sent; a failing save is logged, never raised (best effort). */
function saveLater(history: History | undefined, entry: HistoryEntry): void {
  if (!history) return;
  setImmediate(() => {
    try {
      history.save(entry);
    } catch (err) {
      console.error("histórico: não salvou", err);
    }
  });
}

const historyId = (raw: string): number | null =>
  /^\d+$/.test(raw) ? Number(raw) : null;

/** Local API. Refuses foreign Host headers (DNS rebinding, AD-007) and sets no CORS. */
export function createApp(deps: AppDeps): Hono {
  const allowed = new Set([`127.0.0.1:${deps.port}`, `localhost:${deps.port}`]);
  const app = new Hono();

  app.use("*", async (c, next) => {
    const host = c.req.header("host");
    if (!host || !allowed.has(host)) return c.text("Forbidden", 403);
    await next();
  });

  // A "simple" cross-site POST skips the CORS preflight; only JSON is accepted (AD-016).
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "POST") {
      const type = (c.req.header("content-type") ?? "")
        .split(";")[0]
        ?.trim()
        .toLowerCase();
      if (type !== "application/json")
        return c.text("Unsupported Media Type", 415);
    }
    await next();
  });

  app.post("/api/graph", async (c) => {
    const body = graphBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid body" }, 400);
    let response: GraphResponse;
    try {
      const { plugin, uncertain } = detectLanguage(
        body.data.source,
        deps.plugins,
      );
      response = {
        graph: plugin.extract(body.data.source),
        language: { id: plugin.id, label: plugin.label, uncertain },
      };
    } catch (err) {
      return extractFailed(c, err);
    }
    if (!response.graph.empty) {
      saveLater(deps.history, {
        kind: "snippet",
        source: body.data.source,
        graph: response.graph,
      });
    }
    return c.json(response);
  });

  app.get("/api/languages", (c) => {
    const response: LanguagesResponse = {
      languages: deps.plugins.map(({ id, label, extensions }) => ({
        id,
        label,
        extensions,
      })),
    };
    return c.json(response);
  });

  app.post("/api/project", async (c) => {
    const body = projectBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid body" }, 400);
    const read = await deps.readProject(body.data.path);
    if (read.kind === "not-found") {
      return c.json({ error: "not-found", path: body.data.path }, 404);
    }
    if (!read.response.graph.empty) {
      saveLater(deps.history, {
        kind: "project",
        root: read.root,
        response: read.response,
      });
    }
    return c.json(read.response);
  });

  app.get("/api/history", (c) => {
    if (!deps.history) return c.json({ items: [] });
    return c.json({ items: deps.history.list() });
  });

  app.get("/api/history/:id", (c) => {
    const id = historyId(c.req.param("id"));
    if (id === null) return c.json({ error: "invalid id" }, 400);
    const entry = deps.history?.get(id);
    if (!entry) return c.json({ error: "not-found" }, 404);
    deps.history?.touch(id);
    return c.json({ entry });
  });

  app.put("/api/history/:id/star", async (c) => {
    const id = historyId(c.req.param("id"));
    if (id === null) return c.json({ error: "invalid id" }, 400);
    const body = starBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid body" }, 400);
    if (!deps.history?.star(id, body.data.starred)) {
      return c.json({ error: "not-found" }, 404);
    }
    return c.body(null, 204);
  });

  app.delete("/api/history/:id", (c) => {
    const id = historyId(c.req.param("id"));
    if (id === null) return c.json({ error: "invalid id" }, 400);
    if (!deps.history?.remove(id)) return c.json({ error: "not-found" }, 404);
    return c.body(null, 204);
  });

  app.post("/api/explain", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const project = projectExplainBody.safeParse(raw);
    const snippet = explainBody.safeParse(raw);
    const body = project.success
      ? project.data
      : snippet.success
        ? snippet.data
        : null;
    if (!body) return c.json({ error: "invalid body" }, 400);

    let request: ExplainRequest;
    try {
      const origin = await loadOrigin(body, deps);
      if ("notFound" in origin) {
        return c.json({ error: "not-found", path: origin.notFound }, 404);
      }
      const { graph, codeOf, nameOf, pluginOf, idPrefix } = origin;
      const node = graph.nodes.find((n) => n.id === body.nodeId);
      if (!node) return c.json({ error: "unknown node" }, 404);
      if (node.kind === "folder" || node.kind === "file") {
        return c.json({ error: "node has no explanation" }, 400);
      }
      request = {
        nodeId: `${idPrefix}${node.id}`,
        language: pluginOf(node).id,
        nodeName: node.label,
        nodeKind: node.kind,
        ...codeOf(node),
        range: node.range,
        ...neighboursOf(graph, node, (other) => nameOf(other, node)),
      };
    } catch (err) {
      return extractFailed(c, err);
    }

    const result = await deps.explain(request);
    // unfaithful is an answer, not a failure: 200 like ok and no-key (FID-10).
    return c.json(result, result.status === "error" ? 502 : 200);
  });

  app.post("/api/titles", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const project = projectTitlesBody.safeParse(raw);
    const snippet = titlesBody.safeParse(raw);
    const body = project.success
      ? project.data
      : snippet.success
        ? snippet.data
        : null;
    if (!body) return c.json({ error: "invalid body" }, 400);

    let items: TitleItem[];
    try {
      const origin = await loadOrigin(body, deps);
      if ("notFound" in origin) {
        return c.json({ error: "not-found", path: origin.notFound }, 404);
      }
      const { graph, codeOf, nameOf, pluginOf, idPrefix } = origin;
      const byId = new Map(graph.nodes.map((n) => [n.id, n]));
      // Each id once, in the order received; unknown, folder and file ids are dropped.
      items = [...new Set(body.nodeIds)].flatMap((id) => {
        const node = byId.get(id);
        if (!node || node.kind === "folder" || node.kind === "file") return [];
        return [
          {
            nodeId: node.id,
            cacheKey: `${idPrefix}${node.id}`,
            language: pluginOf(node).id,
            kind: node.kind,
            name: node.label,
            code: codeOf(node).code,
            range: node.range,
            ...neighboursOf(graph, node, (other) => nameOf(other, node)),
          },
        ];
      });
    } catch (err) {
      return extractFailed(c, err);
    }
    if (items.length === 0) {
      const empty: TitlesResponse = { status: "ok", titles: [] };
      return c.json(empty);
    }
    // A title is best effort: the web always has the provisional name, so every status is 200.
    return c.json(await deps.titles({ items }));
  });

  return app;
}
