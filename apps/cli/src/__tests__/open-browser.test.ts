import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { appBrowserPaths, openBrowser, openUrl } from "../open-browser";

const URL = "http://127.0.0.1:8148/#t=abc&pasta=C%3A%5Cproj";

/** A spawn stand-in that records the call and returns a child that can fail. */
function recorder() {
  const calls: { command: string; args: string[]; options: object }[] = [];
  const child = new EventEmitter() as EventEmitter & { unref(): void };
  child.unref = () => {};
  const spawn = (command: string, args: string[], options: object) => {
    calls.push({ command, args, options });
    return child;
  };
  return { calls, child, spawn };
}

describe("openBrowser (DIST-01)", () => {
  it.each([
    ["win32", "rundll32", ["url.dll,FileProtocolHandler", URL]],
    ["darwin", "open", [URL]],
    ["linux", "xdg-open", [URL]],
  ] as const)(
    "on %s runs %s with the url as one argument",
    (platform, command, args) => {
      const r = recorder();
      openBrowser(URL, r.spawn, platform);
      expect(r.calls).toHaveLength(1);
      expect(r.calls[0]?.command).toBe(command);
      expect(r.calls[0]?.args).toEqual(args);
    },
  );

  it("never asks for a shell: the & of the fragment is no command separator", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const r = recorder();
      openBrowser(URL, r.spawn, platform);
      expect(r.calls[0]?.options).not.toHaveProperty("shell", true);
    }
  });

  it("survives a spawn error: the url is already in the terminal", () => {
    const r = recorder();
    openBrowser(URL, r.spawn, "linux");
    expect(() =>
      r.child.emit("error", new Error("spawn xdg-open ENOENT")),
    ).not.toThrow();
  });
});

describe("openUrl: a window of its own for the app", () => {
  const ENV = {
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
  };
  const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const EDGE =
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

  it("runs the browser found with --app=<url> as one argument and no shell", () => {
    const r = recorder();
    openUrl(URL, true, {
      spawn: r.spawn,
      platform: "win32",
      env: ENV,
      exists: (path) => path === EDGE,
    });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]?.command).toBe(EDGE);
    expect(r.calls[0]?.args).toEqual([`--app=${URL}`]);
    expect(r.calls[0]?.options).not.toHaveProperty("shell", true);
  });

  it("prefers Chrome to Edge when both exist", () => {
    const r = recorder();
    openUrl(URL, true, {
      spawn: r.spawn,
      platform: "win32",
      env: ENV,
      exists: () => true,
    });
    expect(r.calls[0]?.command).toBe(CHROME);
  });

  it("opens the default browser when neither Chrome nor Edge is installed", () => {
    const r = recorder();
    openUrl(URL, true, {
      spawn: r.spawn,
      platform: "linux",
      env: {},
      exists: () => false,
    });
    expect(r.calls).toEqual([
      expect.objectContaining({ command: "xdg-open", args: [URL] }),
    ]);
  });

  it("opens the default browser, whatever is installed, when the app window is off", () => {
    const r = recorder();
    openUrl(URL, false, {
      spawn: r.spawn,
      platform: "win32",
      env: ENV,
      exists: () => true,
    });
    expect(r.calls).toEqual([
      expect.objectContaining({
        command: "rundll32",
        args: ["url.dll,FileProtocolHandler", URL],
      }),
    ]);
  });

  it("falls back to the default browser when the browser fails to start", () => {
    const r = recorder();
    openUrl(URL, true, {
      spawn: r.spawn,
      platform: "darwin",
      env: {},
      exists: () => true,
    });
    expect(r.calls).toHaveLength(1);
    r.child.emit("error", new Error("spawn ENOENT"));
    expect(r.calls).toHaveLength(2);
    expect(r.calls[1]).toMatchObject({ command: "open", args: [URL] });
  });

  it.each(["win32", "darwin", "linux"] as const)(
    "lists only absolute paths on %s",
    (platform) => {
      const paths = appBrowserPaths(platform, ENV);
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) expect(path).toMatch(/^([A-Za-z]:\\|\/)/);
    },
  );
});
