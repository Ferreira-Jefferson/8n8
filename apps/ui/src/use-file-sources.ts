import { useEffect, useReducer, useRef } from "react";
import { fetchProjectFile } from "./api";

export interface FileSourceOrigin {
  root: string;
  include: string[];
  /** The build the screen holds; the server answers 409 when the folder moved on. */
  version: string | undefined;
}

const NONE: ReadonlyMap<string, string> = new Map();

/**
 * The source of the files the screen shows, fetched when it first needs them. `owner`
 * names the map: a new map drops what the old one loaded and what was still on the way.
 * A 409 means the folder changed: `onStale` reopens it.
 */
export function useFileSources(
  origin: FileSourceOrigin | null,
  paths: readonly string[],
  owner: unknown,
  onStale: () => void,
): ReadonlyMap<string, string> {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const store = useRef({
    owner,
    loaded: NONE,
    asked: new Set<string>(),
  });
  if (store.current.owner !== owner) {
    store.current = { owner, loaded: NONE, asked: new Set() };
  }
  const stale = useRef(onStale);
  stale.current = onStale;
  const pathsKey = paths.join("\n");
  const originKey = JSON.stringify(origin);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathsKey stands for paths and originKey for origin; owner starts a new store
  useEffect(() => {
    if (origin === null) return;
    const mine = store.current;
    for (const path of pathsKey.split("\n")) {
      if (path === "" || mine.asked.has(path)) continue;
      mine.asked.add(path);
      fetchProjectFile(origin.root, origin.include, path, origin.version)
        .then((r) => {
          if (store.current !== mine) return;
          if (r.status === "stale") {
            stale.current();
            return;
          }
          mine.loaded = new Map(mine.loaded).set(path, r.source);
          refresh();
        })
        .catch(() => {
          // Not loaded: the card keeps its empty line and a new need asks again.
          mine.asked.delete(path);
        });
    }
  }, [pathsKey, originKey, owner]);

  return store.current.loaded;
}
