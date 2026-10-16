// The only file of the project allowed to import node:child_process (DIST-23).
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";

type Spawn = (
  command: string,
  args: string[],
  options: { stdio: "ignore"; detached: boolean },
) => { on(event: "error", listener: () => void): unknown; unref(): void };

/**
 * Opens `url` in the default browser. The url goes as one argument, never through a
 * shell: in cmd the `&` of the fragment would split the command.
 */
export function openBrowser(
  url: string,
  spawn: Spawn = nodeSpawn,
  platform: NodeJS.Platform = process.platform,
): void {
  const [command, args] =
    platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  // No browser is no failure: the url is already printed (DIST-07).
  child.on("error", () => {});
  child.unref();
}

/** Where Chrome and Edge usually sit: the browsers that open a url as a window with no address bar. */
export function appBrowserPaths(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): string[] {
  if (platform === "win32") {
    const roots = [
      env.ProgramFiles,
      env["ProgramFiles(x86)"],
      env.LOCALAPPDATA,
    ].filter((root): root is string => !!root);
    return [
      ...roots.map((r) => `${r}\\Google\\Chrome\\Application\\chrome.exe`),
      ...roots.map((r) => `${r}\\Microsoft\\Edge\\Application\\msedge.exe`),
    ];
  }
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
  ];
}

/**
 * Opens `url` as an app window (`--app=`): no address bar, no tabs, the title and icon of the
 * page. The token stays in the fragment, as in a tab. Without Chrome or Edge, or when the
 * browser fails to start, the url opens in the default browser (DIST-07).
 */
export function openUrl(
  url: string,
  app: boolean,
  deps: {
    spawn?: Spawn;
    platform?: NodeJS.Platform;
    env?: Record<string, string | undefined>;
    exists?: (path: string) => boolean;
  } = {},
): void {
  const {
    spawn = nodeSpawn,
    platform = process.platform,
    env = process.env,
    exists = existsSync,
  } = deps;
  const browser = app
    ? appBrowserPaths(platform, env).find((path) => exists(path))
    : undefined;
  if (browser === undefined) {
    openBrowser(url, spawn, platform);
    return;
  }
  const child = spawn(browser, [`--app=${url}`], {
    stdio: "ignore",
    detached: true,
  });
  child.on("error", () => openBrowser(url, spawn, platform));
  child.unref();
}
