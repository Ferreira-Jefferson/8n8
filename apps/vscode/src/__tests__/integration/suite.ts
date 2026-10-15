// Runs inside a real VS Code (VSC-08): the command opens the panel, the page loads
// under the content policy, and the screen maps the workspace through the bridge.
import * as vscode from "vscode";
import type { ExtensionApi } from "../../extension";

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
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspace) throw new Error("O teste abre o VS Code sem pasta.");

  // VSC-01: the palette command maps the first workspace folder.
  await vscode.commands.executeCommand("8n8.abrirMapa");
  await waitFor(
    () => api.readyCount() >= 1,
    "a página não avisou que carregou",
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

  // VSC-02, VSC-03: the Explorer command on another folder reuses the one panel.
  const before = api.calls().length;
  await vscode.commands.executeCommand(
    "8n8.abrirMapaDaPasta",
    vscode.Uri.joinPath(workspace, "frete"),
  );
  await waitFor(() => api.readyCount() >= 2, "a página nova não carregou");
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
