import { describe, expect, it } from "vitest";
import { readLaunch, TOKEN_KEY } from "../session";

/** A browser stand-in: the url parts, a session store and the history calls. */
function browser(hash: string, stored: Record<string, string> = {}) {
  const store = new Map(Object.entries(stored));
  const replaced: string[] = [];
  return {
    location: { hash, pathname: "/", search: "" },
    storage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    history: {
      replaceState: (_d: unknown, _t: string, url: string) =>
        void replaced.push(url),
    },
    store,
    replaced,
  };
}

const launch = (b: ReturnType<typeof browser>) =>
  readLaunch(b.location, b.storage, b.history);

describe("readLaunch (DIST-19)", () => {
  it("reads the token and the folder from the fragment", () => {
    const b = browser("#t=abc123&pasta=C%3A%5Cproj");
    expect(launch(b)).toEqual({ token: "abc123", folder: "C:\\proj" });
  });

  it("keeps the token in sessionStorage only", () => {
    const b = browser("#t=abc123");
    launch(b);
    expect(b.store.get(TOKEN_KEY)).toBe("abc123");
  });

  it("takes the fragment out of the address bar", () => {
    const b = browser("#t=abc123&pasta=C%3A%5Cproj");
    launch(b);
    expect(b.replaced).toEqual(["/"]);
  });

  it("keeps the session on reload: no fragment reads the stored token", () => {
    const b = browser("", { [TOKEN_KEY]: "abc123" });
    expect(launch(b)).toEqual({ token: "abc123", folder: null });
    expect(b.replaced).toEqual([]);
  });

  it("has no token and no folder when nothing was given", () => {
    expect(launch(browser(""))).toEqual({ token: null, folder: null });
  });
});
