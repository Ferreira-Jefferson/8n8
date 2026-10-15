/** The Host the core's guard accepts; createCore gets this port (VSC-11). */
export const BRIDGE_PORT = 4317;
export const BRIDGE_HOST = `127.0.0.1:${BRIDGE_PORT}`;

const METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);
const MAX_BODY_BYTES = 1024 * 1024;
/** Only API paths, made of plain path characters: no scheme, no `..`, no `//`, no `\`. */
const PATH = /^\/api\/[A-Za-z0-9_\-./]*$/;

/** A message of the webview that asks the API. */
export interface ApiMessage {
  type: "api";
  id: number;
  method: string;
  path: string;
  body?: string;
}

/** The extension's reply, matched by `id` in the webview. */
export interface ApiReply {
  type: "api-response";
  id: number;
  status: number;
  body: string;
  contentType: string;
}

/** The part of the Hono app the bridge calls. */
export interface CoreApp {
  fetch(request: Request): Response | Promise<Response>;
}

/** Whether a webview message is a request the bridge may pass on (VSC-10). */
export function isValidMessage(message: unknown): message is ApiMessage {
  if (typeof message !== "object" || message === null) return false;
  const m = message as Record<string, unknown>;
  const keys = Object.keys(m);
  if (keys.some((k) => !["type", "id", "method", "path", "body"].includes(k))) {
    return false;
  }
  return (
    m.type === "api" &&
    Number.isSafeInteger(m.id) &&
    typeof m.method === "string" &&
    METHODS.has(m.method) &&
    typeof m.path === "string" &&
    PATH.test(m.path) &&
    !m.path.includes("..") &&
    !m.path.includes("//") &&
    // Only POST and PUT carry a body, of 1 048 576 bytes at most.
    (m.body === undefined ||
      ((m.method === "POST" || m.method === "PUT") &&
        typeof m.body === "string" &&
        Buffer.byteLength(m.body, "utf8") <= MAX_BODY_BYTES))
  );
}

const idOf = (message: unknown) => {
  const id = (message as { id?: unknown } | null)?.id;
  return Number.isSafeInteger(id) ? (id as number) : 0;
};

/**
 * The only way from the webview to the core: no port, no network. A valid
 * message becomes a Request with the Host the guard accepts and the session
 * token, which the webview never sees; anything else is a 400 that never
 * reaches the core (VSC-10, VSC-11).
 */
export function createBridge(app: CoreApp, token: string) {
  return {
    async handle(message: unknown): Promise<ApiReply> {
      const id = idOf(message);
      const answer = (status: number, error: string): ApiReply => ({
        type: "api-response",
        id,
        status,
        body: JSON.stringify({ error }),
        contentType: "application/json",
      });
      if (!isValidMessage(message)) return answer(400, "invalid message");
      const headers: Record<string, string> = {
        host: BRIDGE_HOST,
        "x-8n8-token": token,
      };
      if (message.body !== undefined) {
        headers["content-type"] = "application/json";
      }
      let response: Response;
      try {
        response = await app.fetch(
          new Request(`http://${BRIDGE_HOST}${message.path}`, {
            method: message.method,
            headers,
            ...(message.body === undefined ? {} : { body: message.body }),
          }),
        );
      } catch {
        // The page always gets an answer: a failure never leaves its promise open.
        return answer(500, "bridge failed");
      }
      return {
        type: "api-response",
        id,
        status: response.status,
        body: await response.text(),
        contentType: response.headers.get("content-type") ?? "application/json",
      };
    },
  };
}
