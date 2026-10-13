import {
  type ExplainRequest,
  type ExplainResponse,
  type Extractor,
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
    const body = explainBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid body" }, 400);
    const { source, nodeId } = body.data;

    const graph = deps.extractor.extract(source);
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return c.json({ error: "unknown node" }, 404);
    if (node.kind !== "function" && node.kind !== "class") {
      return c.json({ error: "node is not a function or class" }, 400);
    }

    const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label;
    const names = (ids: string[]) =>
      ids.map(label).filter((l): l is string => l !== undefined);
    const calls = graph.edges.filter((e) => e.kind === "calls");
    const request: ExplainRequest = {
      nodeId: node.id,
      nodeName: node.label,
      nodeKind: node.kind,
      code: sliceLines(source, node.range),
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
