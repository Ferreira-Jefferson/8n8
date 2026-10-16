import { describe, expect, it, vi } from "vitest";
import { createProjectCache, fingerprintOf } from "../project-cache";

const file = (path: string, source: string) => ({ path, source });

describe("fingerprintOf", () => {
  it("is the same for the same files and ignored list", () => {
    const a = fingerprintOf([file("a.py", "x = 1\n")], []);
    expect(fingerprintOf([file("a.py", "x = 1\n")], [])).toBe(a);
  });

  it("changes with a file's text, a file's path and the ignored list", () => {
    const base = fingerprintOf([file("a.py", "x = 1\n")], []);
    expect(fingerprintOf([file("a.py", "x = 2\n")], [])).not.toBe(base);
    expect(fingerprintOf([file("b.py", "x = 1\n")], [])).not.toBe(base);
    expect(
      fingerprintOf(
        [file("a.py", "x = 1\n")],
        [{ path: "g.py", reason: "too-large", addable: true }],
      ),
    ).not.toBe(base);
  });

  it("does not mix where one file ends and the next begins", () => {
    expect(fingerprintOf([file("a", "bc")], [])).not.toBe(
      fingerprintOf([file("ab", "c")], []),
    );
  });
});

describe("createProjectCache", () => {
  it("makes a result once while its fingerprint holds", async () => {
    const cache = createProjectCache<number>();
    const make = vi.fn(() => 7);
    expect(await cache.get("k", "f1", make)).toBe(7);
    expect(await cache.get("k", "f1", make)).toBe(7);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("finds a kept result by its fingerprint and nothing else", async () => {
    const cache = createProjectCache<string>();
    expect(cache.find("f1")).toBeUndefined();
    await cache.get("k", "f1", () => "a");
    expect(await cache.find("f1")).toBe("a");
    expect(cache.find("f2")).toBeUndefined();
    await cache.get("k", "f2", () => "b");
    expect(cache.find("f1")).toBeUndefined();
  });

  it("makes it again when the fingerprint changes", async () => {
    const cache = createProjectCache<string>();
    expect(await cache.get("k", "f1", () => "a")).toBe("a");
    expect(await cache.get("k", "f2", () => "b")).toBe("b");
    expect(await cache.get("k", "f1", () => "c")).toBe("c");
  });

  it("makes one result for requests that arrive while it is being made", async () => {
    const cache = createProjectCache<number>();
    let release: (n: number) => void = () => {};
    const make = vi.fn(
      () => new Promise<number>((resolve) => (release = resolve)),
    );
    const first = cache.get("k", "f", make);
    const second = cache.get("k", "f", make);
    await Promise.resolve();
    release(5);
    expect(await Promise.all([first, second])).toEqual([5, 5]);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("never keeps a failure", async () => {
    const cache = createProjectCache<number>();
    await expect(
      cache.get("k", "f", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await cache.get("k", "f", () => 1)).toBe(1);
  });

  it("keeps only the most recent keys", async () => {
    const cache = createProjectCache<string>(2);
    const made: string[] = [];
    const maker = (value: string) => () => {
      made.push(value);
      return value;
    };
    await cache.get("a", "f", maker("a"));
    await cache.get("b", "f", maker("b"));
    await cache.get("a", "f", maker("a again")); // a is now the most recent
    await cache.get("c", "f", maker("c")); // evicts b
    await cache.get("a", "f", maker("a again")); // still there
    await cache.get("b", "f", maker("b again")); // was evicted
    expect(made).toEqual(["a", "b", "c", "b again"]);
  });
});
