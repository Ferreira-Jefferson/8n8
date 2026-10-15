import { describe, expect, it } from "vitest";
import { contentPolicy, newNonce, webviewHtml } from "../webview-html";

// The shape Vite gives the screen's index.html with base "./".
const INDEX = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
    <title>8n8</title>
    <script type="module" crossorigin src="./assets/index-abc.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-abc.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

const SOURCE = "https://file+.vscode-resource.vscode-cdn.net";
const page = (folder: string | null = "C:\\proj\\loja") => ({
  baseUri: `${SOURCE}/c%3A/ext/dist/web`,
  cspSource: SOURCE,
  nonce: "n0nce",
  folder,
});

const metaContent = (html: string, selector: RegExp) =>
  selector.exec(html)?.[1];

describe("contentPolicy (VSC-12)", () => {
  it("is the exact policy of the spec", () => {
    expect(contentPolicy(SOURCE, "n0nce")).toBe(
      `default-src 'none'; script-src 'nonce-n0nce'; style-src ${SOURCE} 'unsafe-inline'; font-src ${SOURCE}; img-src ${SOURCE} data:; connect-src 'none'`,
    );
  });
});

describe("webviewHtml (VSC-12)", () => {
  const html = webviewHtml(INDEX, page());

  it("puts the policy first in <head>, then the base", () => {
    const head = html.slice(html.indexOf("<head>"));
    expect(head.indexOf("Content-Security-Policy")).toBeLessThan(
      head.indexOf("<base "),
    );
    expect(head.indexOf("<base ")).toBeLessThan(head.indexOf("<meta charset"));
    expect(
      metaContent(
        html,
        /http-equiv="Content-Security-Policy" content="([^"]*)"/,
      ),
    ).toBe(contentPolicy(SOURCE, "n0nce"));
    expect(html).toContain(`<base href="${SOURCE}/c%3A/ext/dist/web/">`);
  });

  it("gives every script the nonce and keeps no crossorigin", () => {
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(s).toContain('nonce="n0nce"');
    expect(html).not.toMatch(/crossorigin/i);
  });

  it("marks the page as the vscode host and names the folder", () => {
    expect(html).toContain('<meta name="8n8-host" content="vscode">');
    expect(html).toContain('<meta name="8n8-folder" content="C:\\proj\\loja">');
  });

  it("leaves the folder meta out for the start screen", () => {
    expect(webviewHtml(INDEX, page(null))).not.toContain("8n8-folder");
  });

  it("escapes a folder that would close the attribute", () => {
    const evil = webviewHtml(INDEX, page('C:\\a"><script>alert(1)</script>'));
    expect(evil).not.toContain("<script>alert(1)");
    expect(evil).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("refuses a page without <head>", () => {
    expect(() => webviewHtml("<html></html>", page())).toThrow();
  });
});

describe("newNonce", () => {
  it("is long, random and safe in an attribute", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(newNonce()).not.toBe(a);
  });
});
