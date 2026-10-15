/**
 * The folder a command opens: the Explorer's folder when the command came from
 * there, else the first folder of the workspace, else the one the user picks;
 * null when the user cancels the pick (VSC-01, VSC-02).
 */
export async function folderToOpen(
  fromExplorer: string | undefined,
  workspaceFolders: readonly string[],
  ask: () => Promise<string | undefined>,
): Promise<string | null> {
  if (fromExplorer) return fromExplorer;
  const first = workspaceFolders[0];
  if (first) return first;
  return (await ask()) ?? null;
}
