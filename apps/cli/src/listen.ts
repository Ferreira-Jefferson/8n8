import { listenOptions } from "@8n8/server";
import { serve } from "@hono/node-server";
import type { Hono } from "hono";

/** Serves the app on 127.0.0.1 only (PROJ-08); resolves once listening, rejects with the listen error. */
export function listenOnLoopback(app: Hono, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, ...listenOptions(port) }, () =>
      resolve(),
    );
    server.once("error", reject);
  });
}
