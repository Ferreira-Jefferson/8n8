// Runs inside a real VS Code (VSC-08): the command opens the panel, the page loads
// under the content policy, and the screen maps the workspace through the bridge.
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import type { ExtensionApi } from "../../extension";

/** The folder the panel's page was told to map, or null for the start screen. */
function pageFolder(html: string): string | null {
  const content = html.match(/<meta name="8n8-folder" content="([^"]*)">/)?.[1];
  return content === undefined
    ? null
    : content
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&amp;", "&");
}

function expectFolder(html: string, folder: vscode.Uri): void {
  const got = pageFolder(html);
  if (got?.toLowerCase() !== folder.fsPath.toLowerCase()) {
    throw new Error(`A página recebeu a pasta ${got}, e não ${folder.fsPath}.`);
  }
}

async function waitFor(
  check: () => boolean,
  what: string,
  timeoutMs = 60_000,
): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error(`Tempo esgotado: ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

function mapTabs(): number {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter(
      (t) =>
        t.input instanceof vscode.TabInputWebview &&
        t.input.viewType.endsWith("8n8.mapa"),
    ).length;
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension<ExtensionApi>(
    "ferreira-jefferson.8n8-vscode",
  );
  if (!ext) throw new Error("A extensão 8n8 não está instalada no teste.");
  const api = await ext.activate();
  if (!api)
    throw new Error("Em modo de teste, a extensão devolve a API de teste.");
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspace) throw new Error("O teste abre o VS Code sem pasta.");

  // HOME-01: the palette opens the start screen and maps no folder, even with one open.
  await vscode.commands.executeCommand("8n8.abrirMapa");
  await waitFor(
    () => api.readyCount() >= 1,
    "a página não avisou que carregou",
  );
  await waitFor(
    () => api.calls().some((c) => c.path === "/api/history"),
    "a tela inicial não leu o histórico",
  );
  if (api.calls().some((c) => c.path === "/api/project")) {
    throw new Error("A paleta mapeou uma pasta sem a pessoa pedir.");
  }
  if (pageFolder(api.lastHtml()) !== null) {
    throw new Error("A paleta mandou uma pasta para a página.");
  }

  // HOME-02: the Explorer command maps the folder it was given.
  await vscode.commands.executeCommand("8n8.abrirMapaDaPasta", workspace);
  expectFolder(api.lastHtml(), workspace);
  await waitFor(
    () => api.readyCount() >= 2,
    "a página do mapa não avisou que carregou",
  );
  await waitFor(
    () =>
      api
        .calls()
        .some(
          (c) =>
            c.method === "POST" &&
            c.path === "/api/project" &&
            c.status === 200,
        ),
    "a ponte não respondeu 200 ao mapa da pasta",
  );
  // The screen also read the settings through the bridge.
  await waitFor(
    () =>
      api.calls().some((c) => c.path === "/api/settings" && c.status === 200),
    "a ponte não respondeu às configurações",
  );

  // VSC-12: only the packaged screen is readable, and the page never holds the token.
  const roots = api.webviewOptions()?.localResourceRoots ?? [];
  const expected = join(ext.extensionPath, "dist", "web");
  if (
    roots.length !== 1 ||
    roots[0]?.fsPath.toLowerCase() !== expected.toLowerCase()
  ) {
    throw new Error(
      `localResourceRoots errado: ${roots.map((r) => r.fsPath).join(", ")}`,
    );
  }
  if (/[0-9a-f]{64}/.test(api.lastHtml())) {
    throw new Error(
      "O HTML da webview tem algo com a forma do token da sessão.",
    );
  }

  // VSC-06: APP8N8_AUTO_SUMMARY of the host reaches the core.
  const settings = await api.ask({
    type: "api",
    id: 1,
    method: "GET",
    path: "/api/settings",
  });
  const view = JSON.parse(settings.body) as {
    autoSummary?: boolean;
    env?: Record<string, string>;
  };
  if (
    view.autoSummary !== true ||
    view.env?.autoSummary !== "APP8N8_AUTO_SUMMARY"
  ) {
    throw new Error(`O ambiente não chegou ao núcleo: ${settings.body}`);
  }

  // VSC-04: the summary and the history answer through the same bridge.
  const summary = await api.ask({
    type: "api",
    id: 2,
    method: "POST",
    path: "/api/summary",
    body: JSON.stringify({
      root: workspace.fsPath,
      nodeId: "file:frete/calculo.py/fn:calcular_frete",
      cachedOnly: true,
    }),
  });
  if (
    summary.status !== 200 ||
    JSON.parse(summary.body).status !== "not-cached"
  ) {
    throw new Error(`Resumo pela ponte: ${summary.status} ${summary.body}`);
  }
  // CC-15, only when asked (it spends the subscription): with nothing set, the
  // extension finds the user's Claude Code and answers a real summary with it.
  if (process.env.APP8N8_CLAUDE_SMOKE === "1") {
    const found = JSON.parse(
      (
        await api.ask({
          type: "api",
          id: 10,
          method: "GET",
          path: "/api/settings",
        })
      ).body,
    ) as { provider?: string; claude?: { path: string | null } };
    if (found.provider !== "claude-code" || !found.claude?.path) {
      throw new Error(
        `O Claude Code não virou o padrão: ${JSON.stringify(found)}`,
      );
    }
    const real = await api.ask({
      type: "api",
      id: 11,
      method: "POST",
      path: "/api/summary",
      body: JSON.stringify({
        root: workspace.fsPath,
        nodeId: "file:frete/calculo.py/fn:calcular_frete",
      }),
    });
    if (real.status !== 200 || JSON.parse(real.body).status !== "ok") {
      throw new Error(
        `Resumo real pelo Claude Code: ${real.status} ${real.body}`,
      );
    }
    console.log(
      "8n8: resumo real pelo Claude Code no VS Code:",
      real.body.slice(0, 160),
    );
  }
  // VSC-05: the data folder is VS Code's global storage of this extension, found
  // from the user-data folder the runner chose, not from what the extension says.
  const storage = join(
    process.env.APP8N8_TEST_USER_DATA ?? "",
    "User",
    "globalStorage",
    "ferreira-jefferson.8n8-vscode",
  ).toLowerCase();
  if (
    !process.env.APP8N8_TEST_USER_DATA ||
    api.dataDir().toLowerCase() !== storage
  ) {
    throw new Error(`Pasta de dados fora do globalStorage: ${api.dataDir()}`);
  }
  // The map lands in the history, in that folder.
  await waitFor(
    () => existsSync(join(api.dataDir(), "historico.db")),
    "o histórico não ficou na pasta da extensão",
  );
  const history = await api.ask({
    type: "api",
    id: 3,
    method: "GET",
    path: "/api/history",
  });
  if (
    history.status !== 200 ||
    (JSON.parse(history.body) as { items: unknown[] }).items.length === 0
  ) {
    throw new Error(`Histórico pela ponte: ${history.status} ${history.body}`);
  }

  // VSC-02, VSC-03: the Explorer command on another folder reuses the one panel.
  const before = api.calls().length;
  const frete = vscode.Uri.joinPath(workspace, "frete");
  await vscode.commands.executeCommand("8n8.abrirMapaDaPasta", frete);
  expectFolder(api.lastHtml(), frete);
  await waitFor(() => api.readyCount() >= 3, "a página nova não carregou");
  await waitFor(
    () =>
      api
        .calls()
        .slice(before)
        .some((c) => c.path === "/api/project" && c.status === 200),
    "a pasta nova não foi mapeada",
  );
  if (mapTabs() !== 1) {
    throw new Error(`Esperava um painel do 8n8, achei ${mapTabs()}.`);
  }
  if (!api.hasPanel()) throw new Error("O painel sumiu.");
}
