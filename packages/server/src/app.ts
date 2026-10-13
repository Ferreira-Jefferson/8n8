import type {
  ExplainRequest,
  ExplainResponse,
  Extractor,
} from "@code2n8n/model";
import { Hono } from "hono";
import { z } from "zod";

export interface AppDeps {
  extractor: Extractor;
  explain: (req: ExplainRequest) => Promise<ExplainResponse>;
  port: number;
}

const graphBody = z.object({ source: z.string() });

/** Local API. Refuses foreign Host headers (DNS rebinding, AD-007) and sets no CORS. */
export function createApp(deps: AppDeps): Hono {
  const allowed = new Set([`127.0.0.1:${deps.port}`, `localhost:${deps.port}`]);
  const app = new Hono();

  app.use("*", async (c, next) => {
    const host = c.req.header("host");
    if (!host || !allowed.has(host)) return c.text("Forbidden", 403);
    await next();
  });

  app.post("/api/graph", async (c) => {
    const body = graphBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid body" }, 400);
    return c.json({ graph: deps.extractor.extract(body.data.source) });
  });

  return app;
}
