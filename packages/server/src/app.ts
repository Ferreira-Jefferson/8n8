import {
  DEFAULT_LOCALE,
  type ExplainPart,
  type ExplainRequest,
  type ExplainResponse,
  type FlowNode,
  fileNodeOf,
  type Graph,
  type GraphResponse,
  type LanguagePlugin,
  type LanguagesResponse,
  type Locale,
  type ProjectResponse,
  type TitleItem,
  type TitleRequest,
  type TitlesResponse,
  translateSystem,
} from "@8n8/model";
import { detectLanguage, pluginForPath } from "@8n8/project";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { maskDocstring } from "./docstring";
import type { History, MadeMap } from "./history";
import type { PickPath } from "./pick-path";
import { InvalidSettings, type SettingsService } from "./settings";
import { sameToken } from "./token";

export type ProjectRead =
  | { kind: "ok"; root: string; response: ProjectResponse }
  | { kind: "not-found" };

export interface AppDeps {
  /** The registered languages, in a stable order: a snippet is read by the best score, a file by its extension. */
  plugins: LanguagePlugin[];
  /** One part of a node's explanation; `cachedOnly` never calls the LLM (CFG-01, CFG-02, CFG-05). */
  explain: (
    part: ExplainPart,
    req: ExplainRequest,
    options: { cachedOnly: boolean },
  ) => Promise<ExplainResponse<unknown>>;
  titles: (req: TitleRequest) => Promise<TitlesResponse>;
  /** `include`: files over 1 MB the person put on the map (CLEAN-06). */
  readProject: (path: string, include?: string[]) => Promise<ProjectRead>;
  port: number;
  /** The session token every /api call must carry in x-8n8-token (DIST-20). */
  token: string;
  /** Saved searches; absent in tests that do not need them. */
  history?: History | undefined;
  /** The LLM settings; absent in tests that do not need them (CFG-12, CFG-13). */
  settings?:
    | (Pick<SettingsService, "view" | "update" | "setClaudePath"> &
        Partial<Pick<SettingsService, "locale">>)
    | undefined;
  /** The system's file or folder chooser; absent in tests that do not need it. */
  pick?: PickPath | undefined;
}

/** Files over 1 MB put on the map: relative POSIX paths, never outside the folder (CLEAN-07). */
const include = z
  .array(
    z
      .string()
      .min(1)
      .max(1024)
      .refine(
        (p) =>
          !p.startsWith("/") &&
          !p.includes("\\") &&
          !p.includes(":") &&
          !p.split("/").includes(".."),
      ),
  )
  .max(100)
  .optional();
const projectBody = z.object({ path: z.string().min(1), include });
const pickBody = z.object({ kind: z.enum(["folder", "file", "any"]) });
// The Claude Code path never comes in the body: only the system chooser gives it (CC-12, CC-18).
const claudePathBody = z.object({ action: z.enum(["pick", "auto"]) }).strict();
const graphBody = z.object({ source: z.string() });
const starBody = z.object({ starred: z.boolean() });
// Extra fields from the client (code, calls...) are dropped: the server builds the request (CORE-17).
const cachedOnly = z.boolean().optional();
const projectExplainBody = z.object({
  root: z.string().min(1),
  include,
  nodeId: z.string(),
  cachedOnly,
});
const explainBody = z.object({
  source: z.string(),
  nodeId: z.string(),
  cachedOnly,
});
const nodeIds = z.array(z.string()).max(200);
const projectTitlesBody = z.object({
  root: z.string().min(1),
  include,
  nodeIds,
});
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

/** The name the LLM reads: what the code calls the node, or, for loose code and steps the system names, the system's word in its language. */
function nameOfNode(node: FlowNode, locale: Locale): string {
  if (node.kind === "code") return translateSystem(locale, "node.code");
  if (node.kind === "module") return translateSystem(locale, "node.module");
  return node.label;
}

/** Reads `{ source }` or `{ root }`; a missing folder gives `{ notFound }`. The client sends no code (AD-015). */
async function loadOrigin(
  body: { source: string } | { root: string; include?: string[] | undefined },
  deps: AppDeps,
): Promise<Origin | { notFound: string }> {
  // The masked docstring line is part of the code the LLM reads: it speaks the language of the system.
  const locale = (await deps.settings?.locale?.()) ?? DEFAULT_LOCALE;
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
          locale,
        ),
      nameOf: (node) => nameOfNode(node, locale),
      pluginOf: () => plugin,
      idPrefix: `${plugin.id}|`,
    };
  }
  const read = await deps.readProject(body.root, body.include);
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
      // A file hides the docstrings of every node in it, like each node hides its own.
      const docstrings =
        node.kind === "file"
          ? graph.nodes.flatMap((n) =>
              n.docstring && filePath(n) === path ? [n.docstring] : [],
            )
          : node.docstring;
      return maskDocstring(
        node.range,
        docstrings,
        (file?.source ?? "").split(/\r?\n/),
        pluginOf(node).commentPrefix,
        locale,
      );
    },
    pluginOf,
    // A neighbour from another file is named `<path>:<label>`.
    nameOf: (node, home) =>
      filePath(node) !== filePath(home)
        ? `${filePath(node)}:${nameOfNode(node, locale)}`
        : nameOfNode(node, locale),
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
function saveLater(history: History | undefined, map: MadeMap): void {
  if (!history) return;
  setImmediate(() => {
    try {
      history.save(map);
    } catch (err) {
      console.error("histórico: não salvou", err);
    }
  });
}

const historyId = (raw: string): number | null =>
  /^\d+$/.test(raw) ? Number(raw) : null;

/** Local API. Refuses foreign Host headers (DNS rebinding, AD-007) and sets no CORS. */
export function createApp(deps: AppDeps): Hono {
  // 8n8.localhost is the name the CLI shows; browsers resolve *.localhost to loopback only.
  const allowed = new Set([
    `127.0.0.1:${deps.port}`,
    `localhost:${deps.port}`,
    `8n8.localhost:${deps.port}`,
  ]);
  const app = new Hono();

  app.use("*", async (c, next) => {
    const host = c.req.header("host");
    if (!host || !allowed.has(host)) return c.text("Forbidden", 403);
    await next();
  });

  // Only the tab the CLI opened holds the token: any other local process gets 401 (DIST-20).
  app.use("/api/*", async (c, next) => {
    if (!sameToken(deps.token, c.req.header("x-8n8-token"))) {
      return c.text("Unauthorized", 401);
    }
    await next();
  });

  // A "simple" cross-site POST skips the CORS preflight; only JSON is accepted (AD-016).
  // PUT needs a preflight anyway; it gets the same rule, so no write takes another type.
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "POST" || c.req.method === "PUT") {
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
    const read = await deps.readProject(body.data.path, body.data.include);
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

  // The server runs on the person's machine, so the chooser opens on their screen.
  app.post("/api/pick", async (c) => {
    const body = pickBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid body" }, 400);
    if (!deps.pick) return c.json({ error: "not-found" }, 404);
    try {
      const extensions = deps.plugins.flatMap((p) => p.extensions);
      const locale = (await deps.settings?.locale?.()) ?? DEFAULT_LOCALE;
      return c.json({
        path: await deps.pick(body.data.kind, extensions, undefined, locale),
      });
    } catch (err) {
      console.error("seletor: não abriu", (err as Error).message);
      return c.json({ error: "pick-failed" }, 500);
    }
  });

  app.get("/api/history", (c) => {
    if (!deps.history) return c.json({ items: [] });
    return c.json({ items: deps.history.list() });
  });

  app.get("/api/history/:id", (c) => {
    const id = historyId(c.req.param("id"));
    if (id === null) return c.json({ error: "invalid id" }, 400);
    const entry = deps.history?.get(id);
    // Opening it re-reads the folder or the text, and that read counts the visit.
    if (!entry) return c.json({ error: "not-found" }, 404);
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

  /** One part of a node's explanation, built from the server graph (AD-015, CFG-01, CFG-02). */
  const explainRoute = (part: ExplainPart) => async (c: Context) => {
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
      const origin = await loadOrigin(
        "root" in body
          ? { root: body.root, include: body.include }
          : { source: body.source },
        deps,
      );
      if ("notFound" in origin) {
        return c.json({ error: "not-found", path: origin.notFound }, 404);
      }
      const { graph, codeOf, nameOf, pluginOf, idPrefix } = origin;
      const node = graph.nodes.find((n) => n.id === body.nodeId);
      if (!node) return c.json({ error: "unknown node" }, 404);
      if (node.kind === "folder") {
        return c.json({ error: "node has no explanation" }, 400);
      }
      request = {
        nodeId: `${idPrefix}${node.id}`,
        language: pluginOf(node).id,
        nodeName: nameOf(node, node),
        nodeKind: node.kind,
        ...codeOf(node),
        range: node.range,
        ...neighboursOf(graph, node, (other) => nameOf(other, node)),
      };
    } catch (err) {
      return extractFailed(c, err);
    }

    const result = await deps.explain(part, request, {
      cachedOnly: body.cachedOnly ?? false,
    });
    // unfaithful, no-key and not-cached are answers, not failures: 200 like ok (FID-10).
    return c.json(result, result.status === "error" ? 502 : 200);
  };
  app.post("/api/summary", explainRoute("summary"));
  app.post("/api/suggestions", explainRoute("suggestions"));

  // The key goes in through PUT and never comes back: the view says only whether one exists (CFG-12, CFG-13).
  app.get("/api/settings", async (c) => {
    if (!deps.settings) return c.json({ error: "not-found" }, 404);
    return c.json(await deps.settings.view());
  });

  app.put("/api/settings", async (c) => {
    if (!deps.settings) return c.json({ error: "not-found" }, 404);
    const raw = await c.req.json().catch(() => undefined);
    try {
      return c.json(await deps.settings.update(raw));
    } catch (err) {
      if (err instanceof InvalidSettings) {
        return c.json({ error: "invalid settings" }, 400);
      }
      // Only the error code reaches the terminal: a message could carry the key (DIST-22).
      console.error(
        "configurações: não salvou",
        (err as NodeJS.ErrnoException).code ?? "erro desconhecido",
      );
      return c.json({ error: "save failed" }, 500);
    }
  });

  // "pick" opens the system's file chooser and stores the claude it gives; "auto" erases it.
  app.post("/api/settings/claude-path", async (c) => {
    const body = claudePathBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid body" }, 400);
    if (!deps.settings) return c.json({ error: "not-found" }, 404);
    if (body.data.action === "auto") {
      return c.json(await deps.settings.setClaudePath(null));
    }
    if (!deps.pick) return c.json({ error: "not-found" }, 404);
    let path: string | null;
    try {
      path = await deps.pick(
        "file",
        [".exe"],
        "Claude Code",
        (await deps.settings.locale?.()) ?? DEFAULT_LOCALE,
      );
    } catch (err) {
      console.error("seletor: não abriu", (err as Error).message);
      return c.json({ error: "pick-failed" }, 500);
    }
    // Closed without a choice: nothing changes.
    if (path === null) return c.json(await deps.settings.view());
    try {
      return c.json(await deps.settings.setClaudePath(path));
    } catch (err) {
      if (err instanceof InvalidSettings) {
        return c.json({ error: "not-claude" }, 400);
      }
      throw err;
    }
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
            name: nameOf(node, node),
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
    // A title is best effort: the UI always has the provisional name, so every status is 200.
    return c.json(await deps.titles({ items }));
  });

  return app;
}
