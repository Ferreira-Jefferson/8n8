import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { createCore } from "@8n8/server";
import * as vscode from "vscode";
import { BRIDGE_PORT, createBridge } from "./bridge";
import { folderToOpen } from "./folder";
import { dataPaths, panelOptions } from "./panel";
import { createVscodeSettingsStore } from "./store";
import { newNonce, webviewHtml } from "./webview-html";

/**
 * What the integration test reads through the extension's exports (VSC-08). It
 * exists only when VS Code runs the extension's tests: another extension never
 * gets a way into the core, which spends the user's key.
 */
export interface ExtensionApi {
  /** How many pages announced they loaded. */
  readyCount(): number;
  /** The last bridge calls: method, path and the core's status. */
  calls(): { method: string; path: string; status: number }[];
  /** Whether the map panel is open. */
  hasPanel(): boolean;
  /** The options the panel was created with. */
  webviewOptions(): vscode.WebviewOptions | undefined;
  /** The page the panel got last. */
  lastHtml(): string;
  /** One message through the same bridge the page uses. */
  ask(message: unknown): Promise<{ status: number; body: string }>;
  /** The extension's data folder. */
  dataDir(): string;
}

const MAX_CALLS = 100;

export function activate(
  context: vscode.ExtensionContext,
): ExtensionApi | undefined {
  // dist/ holds this bundle, the grammars, the screen and the PTS rules (VSC-07).
  const dist = join(context.extensionPath, "dist");
  const webRoot = vscode.Uri.joinPath(context.extensionUri, "dist", "web");
  const data = context.globalStorageUri.fsPath;
  // The token never leaves the extension: the bridge adds it (VSC-11).
  const token = randomBytes(32).toString("hex");
  let core: Promise<ReturnType<typeof createCore>> | undefined;
  // The core is an ESM bundle next to this one, loaded on the first command.
  const coreApp = () => {
    core ??= (
      import(pathToFileURL(join(dist, "core.mjs")).href) as Promise<{
        createCore: typeof createCore;
      }>
    ).then(({ createCore }) =>
      createCore({
        env: process.env,
        ptsRules: readFileSync(join(dist, "pts.md"), "utf8"),
        ...dataPaths(data, join),
        port: BRIDGE_PORT,
        token,
        settings: createVscodeSettingsStore(
          context.secrets,
          context.globalState,
        ),
      }),
    );
    return core;
  };

  const bridge = createBridge(
    { fetch: async (request) => (await coreApp()).fetch(request) },
    token,
  );
  let panel: vscode.WebviewPanel | undefined;
  let ready = 0;
  const calls: { method: string; path: string; status: number }[] = [];

  const show = (folder: string) => {
    if (panel) {
      panel.reveal(vscode.ViewColumn.Beside);
    } else {
      const created = vscode.window.createWebviewPanel(
        "8n8.mapa",
        "8n8",
        vscode.ViewColumn.Beside,
        panelOptions(webRoot),
      );
      created.webview.onDidReceiveMessage(
        async (message: unknown) => {
          if ((message as { type?: unknown } | null)?.type === "ready") {
            ready++;
            return;
          }
          const reply = await bridge.handle(message);
          const { method, path } = (message ?? {}) as {
            method?: unknown;
            path?: unknown;
          };
          calls.push({
            method: String(method),
            path: String(path),
            status: reply.status,
          });
          if (calls.length > MAX_CALLS) calls.shift();
          void created.webview.postMessage(reply);
        },
        undefined,
        context.subscriptions,
      );
      created.onDidDispose(
        () => {
          panel = undefined;
        },
        undefined,
        context.subscriptions,
      );
      panel = created;
    }
    // A new page per folder: the screen reads the folder from its meta (VSC-03).
    panel.webview.html = webviewHtml(
      readFileSync(join(dist, "web", "index.html"), "utf8"),
      {
        baseUri: panel.webview.asWebviewUri(webRoot).toString(),
        cspSource: panel.webview.cspSource,
        nonce: newNonce(),
        folder,
      },
    );
  };

  const open = async (uri?: vscode.Uri) => {
    const folder = await folderToOpen(
      uri?.fsPath,
      (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
      async () =>
        (
          await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: "Abrir mapa",
          })
        )?.[0]?.fsPath,
    );
    if (folder !== null) show(folder);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("8n8.abrirMapa", open),
    vscode.commands.registerCommand("8n8.abrirMapaDaPasta", open),
  );

  if (context.extensionMode !== vscode.ExtensionMode.Test) return undefined;
  return {
    readyCount: () => ready,
    calls: () => [...calls],
    hasPanel: () => panel !== undefined,
    webviewOptions: () => panel?.webview.options,
    lastHtml: () => panel?.webview.html ?? "",
    ask: async (message) => {
      const { status, body } = await bridge.handle(message);
      return { status, body };
    },
    dataDir: () => data,
  };
}

export function deactivate(): void {}
