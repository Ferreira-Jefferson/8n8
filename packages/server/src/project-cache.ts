import { createHash } from "node:crypto";
import type { IgnoredFile, SourceFile } from "@8n8/model";

/** The thread gives way after hashing this many characters, so hashing a big folder never holds it for long. */
const HASHED_AT_A_TIME = 1 << 20;

/** The same files and the same ignored list give the same project: a hash tells them apart. */
export async function fingerprintOf(
  files: readonly SourceFile[],
  ignored: readonly IgnoredFile[],
): Promise<string> {
  const hash = createHash("sha1");
  let hashed = 0;
  for (const { path, source } of files) {
    hash.update(path);
    hash.update("\0");
    hash.update(source);
    hash.update("\0");
    hashed += source.length;
    if (hashed >= HASHED_AT_A_TIME) {
      hashed = 0;
      await new Promise((go) => setImmediate(go));
    }
  }
  hash.update("\0ignored\0");
  for (const { path, reason, addable } of ignored) {
    hash.update(`${path}\0${reason}\0${addable ?? ""}\0`);
  }
  return hash.digest("hex");
}

/** Names one build: the same files in another folder, or read with another set of options, are another build. */
export function versionOf(key: string, fingerprint: string): string {
  return createHash("sha1").update(`${key}\0${fingerprint}`).digest("hex");
}

/**
 * The last results, by key, each valid while its fingerprint holds. A request for
 * a result that is still being made waits for it instead of making it again, and
 * a failure is never kept. Few entries: one result is a whole project's graph.
 */
export function createProjectCache<T>(size = 2) {
  const entries = new Map<string, { fingerprint: string; value: Promise<T> }>();
  return {
    /** The result made for a fingerprint, if it is still kept. */
    find(fingerprint: string): Promise<T> | undefined {
      for (const entry of entries.values()) {
        if (entry.fingerprint === fingerprint) return entry.value;
      }
      return undefined;
    },
    get(
      key: string,
      fingerprint: string,
      make: () => T | Promise<T>,
    ): Promise<T> {
      const found = entries.get(key);
      if (found?.fingerprint === fingerprint) {
        // Most recently used goes last.
        entries.delete(key);
        entries.set(key, found);
        return found.value;
      }
      const value = Promise.resolve().then(make);
      entries.delete(key);
      entries.set(key, { fingerprint, value });
      for (const oldest of entries.keys()) {
        if (entries.size <= size) break;
        entries.delete(oldest);
      }
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      return value;
    },
  };
}
