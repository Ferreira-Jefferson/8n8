import { randomBytes } from "node:crypto";

export interface WebviewPage {
  /** webview.asWebviewUri of the packaged screen folder, without a trailing slash. */
  baseUri: string;
  /** webview.cspSource: the origin VS Code serves the extension's files from. */
  cspSource: string;
  /** A fresh random nonce per page: only scripts carrying it run. */
  nonce: string;
  /** The folder to open, or null for the start screen. */
  folder: string | null;
}

const attr = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** No network, no inline script, no other origin (VSC-12). */
export function contentPolicy(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource}`,
    `img-src ${cspSource} data:`,
    "connect-src 'none'",
  ].join("; ");
}

export function newNonce(): string {
  return randomBytes(18).toString("base64url");
}

/**
 * The built screen's index.html, made into the webview page: the policy and the
 * base first in <head>, the host and folder metas, the nonce on every script, and
 * no `crossorigin` (the webview's file server does not answer CORS).
 */
export function webviewHtml(indexHtml: string, page: WebviewPage): string {
  if (!/<head>/i.test(indexHtml)) throw new Error("index.html sem <head>");
  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${attr(contentPolicy(page.cspSource, page.nonce))}">`,
    `<base href="${attr(page.baseUri)}/">`,
    '<meta name="8n8-host" content="vscode">',
    ...(page.folder === null
      ? []
      : [`<meta name="8n8-folder" content="${attr(page.folder)}">`]),
  ].join("\n    ");
  return indexHtml
    .replace(/\s+crossorigin(?:="[^"]*")?/gi, "")
    .replace(/<script\b/gi, `<script nonce="${page.nonce}"`)
    .replace(/<head>/i, `<head>\n    ${head}`);
}
