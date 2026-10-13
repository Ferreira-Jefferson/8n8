import type {
  ExplainRequest,
  ExplainResponse,
  Extractor,
} from "@code2n8n/model";
import { Hono } from "hono";

export interface AppDeps {
  extractor: Extractor;
  explain: (req: ExplainRequest) => Promise<ExplainResponse>;
  port: number;
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

  return app;
}
