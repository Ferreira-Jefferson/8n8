// The only file of the project allowed to import node:child_process (DIST-23).
import { spawn as nodeSpawn } from "node:child_process";

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
