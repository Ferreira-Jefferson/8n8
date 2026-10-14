import {
  type ExplainRequest,
  type ExplainResponse,
  type Extractor,
  type FlowNode,
  fileNodeOf,
  type Graph,
  type ProjectResponse,
  type TitleItem,
  type TitleRequest,
  type TitlesResponse,
} from "@code2n8n/model";
import { Hono } from "hono";
import { z } from "zod";
import { maskDocstring } from "./docstring";

export type ProjectRead =
  | { kind: "ok"; root: string; response: ProjectResponse }
  | { kind: "not-found" };

export interface AppDeps {
  extractor: Extractor;
  explain: (req: ExplainRequest) => Promise<ExplainResponse>;
  titles: (req: TitleRequest) => Promise<TitlesResponse>;
  readProject: (path: string) => Promise<ProjectRead>;
  port: number;
}

const projectBody = z.object({ path: z.string().min(1) });
const graphBody = z.object({ source: z.string() });
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
  /** `<POSIX root>|` in a project, empty in a snippet. */
  idPrefix: string;
}

/** Reads `{ source }` or `{ root }`; a missing folder gives `{ notFound }`. The client sends no code (AD-015). */
async function loadOrigin(
  body: { source: string } | { root: string },
  deps: AppDeps,
): Promise<Origin | { notFound: string }> {
  if ("source" in body) {
    const { source } = body;
    return {
      graph: deps.extractor.extract(source),
      codeOf: (node) =>
        maskDocstring(node.range, node.docstring, source.split(/\r?\n/)),
      nameOf: (node) => node.label,
      idPrefix: "",
    };
  }
  const read = await deps.readProject(body.root);
  if (read.kind === "not-found") return { notFound: body.root };
  const { response } = read;
  const graph = response.graph;
  const filePath = (node: FlowNode) => fileNodeOf(graph, node.id)?.path ?? "";
  return {
    graph,
    codeOf: (node) => {
      const path = filePath(node);
      const file = response.files.find((f) => f.path === path);
      return maskDocstring(
        node.range,
        node.docstring,
        (file?.source ?? "").split(/\r?\n/),
      );
    },
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
    return c.json({ graph: deps.extractor.extract(body.data.source) });
  });

  app.post("/api/project", async (c) => {
    const body = projectBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid body" }, 400);
    const read = await deps.readProject(body.data.path);
    if (read.kind === "not-found") {
      return c.json({ error: "not-found", path: body.data.path }, 404);
    }
    return c.json(read.response);
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

    const origin = await loadOrigin(body, deps);
    if ("notFound" in origin) {
      return c.json({ error: "not-found", path: origin.notFound }, 404);
    }
    const { graph, codeOf, nameOf, idPrefix } = origin;
    const node = graph.nodes.find((n) => n.id === body.nodeId);
    if (!node) return c.json({ error: "unknown node" }, 404);
    if (node.kind === "folder" || node.kind === "file") {
      return c.json({ error: "node has no explanation" }, 400);
    }

    const request: ExplainRequest = {
      nodeId: `${idPrefix}${node.id}`,
      nodeName: node.label,
      nodeKind: node.kind,
      ...codeOf(node),
      range: node.range,
      ...neighboursOf(graph, node, (other) => nameOf(other, node)),
    };

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

    const origin = await loadOrigin(body, deps);
    if ("notFound" in origin) {
      return c.json({ error: "not-found", path: origin.notFound }, 404);
    }
    const { graph, codeOf, nameOf, idPrefix } = origin;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    // Each id once, in the order received; unknown, folder and file ids are dropped.
    const items: TitleItem[] = [...new Set(body.nodeIds)].flatMap((id) => {
      const node = byId.get(id);
      if (!node || node.kind === "folder" || node.kind === "file") return [];
      return [
        {
          nodeId: node.id,
          cacheKey: `${idPrefix}${node.id}`,
          kind: node.kind,
          name: node.label,
          code: codeOf(node).code,
          range: node.range,
          ...neighboursOf(graph, node, (other) => nameOf(other, node)),
        },
      ];
    });
    if (items.length === 0) {
      const empty: TitlesResponse = { status: "ok", titles: [] };
      return c.json(empty);
    }
    // A title is best effort: the web always has the provisional name, so every status is 200.
    return c.json(await deps.titles({ items }));
  });

  return app;
}
