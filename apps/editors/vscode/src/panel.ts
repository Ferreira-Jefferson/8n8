/** The webview options of the map panel: scripts on, and only the packaged screen readable (VSC-12). */
export function panelOptions<U>(webRoot: U): {
  enableScripts: true;
  localResourceRoots: U[];
  retainContextWhenHidden: true;
} {
  return {
    enableScripts: true,
    localResourceRoots: [webRoot],
    retainContextWhenHidden: true,
  };
}

/** Where the extension keeps its data: the cache and the history under the editor's global storage (VSC-05). */
export function dataPaths(
  globalStorage: string,
  join: (...p: string[]) => string,
) {
  return {
    cacheDir: join(globalStorage, "cache"),
    historyFile: join(globalStorage, "historico.db"),
  };
}
