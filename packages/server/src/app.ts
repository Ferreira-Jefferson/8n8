import {
  type ExplainRequest,
  type ExplainResponse,
  type Extractor,
  type FlowNode,
  fileNodeOf,
  type Graph,
  type ProjectResponse,
  sliceLines,
} from "@code2n8n/model";
import { Hono } from "hono";
import { z } from "zod";

export type ProjectRead =
  | { kind: "ok"; root: string; response: ProjectResponse }
  | { kind: "not-found" };

export interface AppDeps {
  extractor: Extractor;
  explain: (req: ExplainRequest) => Promise<ExplainResponse>;
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
    if (!project.success && !snippet.success) {
      return c.json({ error: "invalid body" }, 400);
    }

    let graph: Graph;
    let nodeId: string;
    let codeOf: (node: FlowNode) => string;
    let nameOf: (node: FlowNode) => string;
    let idPrefix = "";
    if (project.success) {
      // The client sends no code: the folder is read and extracted again (AD-015).
      const read = await deps.readProject(project.data.root);
      if (read.kind === "not-found") {
        return c.json({ error: "not-found", path: project.data.root }, 404);
      }
      const { response } = read;
      graph = response.graph;
      nodeId = project.data.nodeId;
      const filePath = (node: FlowNode) => {
        const file = fileNodeOf(graph, node.id);
        return file?.path ?? "";
      };
      codeOf = (node) => {
        const path = filePath(node);
        const file = response.files.find((f) => f.path === path);
        return sliceLines(file?.source ?? "", node.range);
      };
      // A neighbour from another file is named `<path>:<label>`.
      const home = graph.nodes.find((n) => n.id === nodeId);
      nameOf = (node) =>
        home && filePath(node) !== filePath(home)
          ? `${filePath(node)}:${node.label}`
          : node.label;
      idPrefix = `${read.root.replaceAll("\\", "/")}|`;
    } else if (snippet.success) {
      const { source } = snippet.data;
      graph = deps.extractor.extract(source);
      nodeId = snippet.data.nodeId;
      codeOf = (node) => sliceLines(source, node.range);
      nameOf = (node) => node.label;
    } else {
      return c.json({ error: "invalid body" }, 400);
    }

    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return c.json({ error: "unknown node" }, 404);
    if (node.kind !== "function" && node.kind !== "class") {
      return c.json({ error: "node is not a function or class" }, 400);
    }

    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const names = (ids: string[]) =>
      ids.flatMap((id) => {
        const other = byId.get(id);
        return other ? [nameOf(other)] : [];
      });
    const calls = graph.edges.filter((e) => e.kind === "calls");
    const request: ExplainRequest = {
      nodeId: `${idPrefix}${node.id}`,
      nodeName: node.label,
      nodeKind: node.kind,
      code: codeOf(node),
      range: node.range,
      calls: names(
        calls.filter((e) => e.source === node.id).map((e) => e.target),
      ),
      calledBy: names(
        calls.filter((e) => e.target === node.id).map((e) => e.source),
      ),
    };

    const result = await deps.explain(request);
    // unfaithful is an answer, not a failure: 200 like ok and no-key (FID-10).
    return c.json(result, result.status === "error" ? 502 : 200);
  });

  return app;
}
