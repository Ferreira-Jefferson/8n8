/** What the VS Code webview gives a page: one channel to the extension. */
interface VsCodeApi {
  postMessage(message: unknown): void;
}

/** A reply of the extension to one API message (VSC-10). */
interface ApiReply {
  type: "api-response";
  id: number;
  status: number;
  body: string;
  contentType?: string;
}

let api: VsCodeApi | null | undefined;

/**
 * The VS Code API when the page runs in the extension's webview: the extension
 * marks the page with `<meta name="8n8-host" content="vscode">`. A webview may
 * acquire it only once, so it is kept here.
 */
export function vscodeHost(): VsCodeApi | null {
  if (api !== undefined) return api;
  const host = document
    .querySelector('meta[name="8n8-host"]')
    ?.getAttribute("content");
  const acquire = (globalThis as { acquireVsCodeApi?: () => VsCodeApi })
    .acquireVsCodeApi;
  api = host === "vscode" && typeof acquire === "function" ? acquire() : null;
  return api;
}

let nextId = 0;
const pending = new Map<number, (reply: ApiReply) => void>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("message", (event: MessageEvent) => {
    const reply = event.data as Partial<ApiReply> | null;
    if (reply?.type !== "api-response" || typeof reply.id !== "number") return;
    const resolve = pending.get(reply.id);
    if (!resolve) return;
    pending.delete(reply.id);
    resolve(reply as ApiReply);
  });
}

/**
 * One API call through the extension, as a fetch: the page never opens a
 * connection, and the extension adds the Host and the session token (VSC-11).
 */
export function bridgeFetch(
  host: VsCodeApi,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  listen();
  const id = ++nextId;
  return new Promise((resolve) => {
    pending.set(id, (reply) => {
      const empty = reply.status === 204 || reply.status === 304;
      resolve(
        new Response(empty ? null : reply.body, {
          status: reply.status,
          headers: {
            "content-type": reply.contentType ?? "application/json",
          },
        }),
      );
    });
    host.postMessage({
      type: "api",
      id,
      method: init.method ?? "GET",
      path,
      ...(typeof init.body === "string" ? { body: init.body } : {}),
    });
  });
}

/** Forgets the acquired API; tests run each case on a fresh page. */
export function resetVscodeHostForTest(): void {
  api = undefined;
}
