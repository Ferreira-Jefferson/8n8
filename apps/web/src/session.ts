/** Where the session token lives: sessionStorage, so it dies with the tab (DIST-19). */
export const TOKEN_KEY = "8n8-token";

export interface Launch {
  token: string | null;
  /** The folder the CLI asked to open, or null. */
  folder: string | null;
}

/**
 * Reads `#t=<token>&pasta=<folder>` from the url the CLI opened, keeps the token in
 * sessionStorage and takes the fragment out of the address bar. Without a fragment,
 * the token stored by an earlier load is used. In the VS Code webview the folder
 * comes from a meta tag and there is no token: the extension adds it.
 */
export function readLaunch(
  location: Pick<Location, "hash" | "pathname" | "search">,
  storage: Pick<Storage, "getItem" | "setItem">,
  history: Pick<History, "replaceState">,
  /** The folder the VS Code extension put in `<meta name="8n8-folder">` (VSC-01). */
  metaFolder: string | null = null,
): Launch {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const token = params.get("t");
  const fromFragment = params.get("pasta");
  if (token !== null) storage.setItem(TOKEN_KEY, token);
  // Only a fragment leaves the address bar; a meta folder never touches the history.
  if (token !== null || fromFragment !== null) {
    history.replaceState(null, "", location.pathname + location.search);
  }
  return {
    token: token ?? storage.getItem(TOKEN_KEY),
    folder: fromFragment ?? metaFolder,
  };
}
