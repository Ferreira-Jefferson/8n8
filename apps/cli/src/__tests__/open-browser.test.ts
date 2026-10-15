import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { openBrowser } from "../open-browser";

const URL = "http://127.0.0.1:4317/#t=abc&pasta=C%3A%5Cproj";

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
