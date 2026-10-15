import { childId, fileId, type NodeId } from "@8n8/model";
import type { Node } from "web-tree-sitter";
import { allocateTopLevel } from "./build-graph";
import { importAliases } from "./imports";

/** Dotted module name of a POSIX `.py` path; null for the root `__init__.py`. */
export function moduleNameOf(path: string): string | null {
  const parts = path.replace(/\.py$/, "").split("/");
  if (parts[parts.length - 1] === "__init__") parts.pop();
  return parts.length === 0 ? null : parts.join(".");
}

/** Dotted package that holds `path`; `""` for a file at the root. */
export function packageOf(path: string): string {
  return path.split("/").slice(0, -1).join(".");
}

/**
 * Base module of a relative import with `level` dots: the package of
 * `path`, up `level - 1` levels. Null when that goes above the root.
 */
export function relativeBase(path: string, level: number): string | null {
  const pkg = packageOf(path);
  const segments = pkg === "" ? [] : pkg.split(".");
  const up = level - 1;
  if (up >= segments.length) return null;
  return segments.slice(0, segments.length - up).join(".");
}

/** `name` with its leading dots replaced by the base seen from `path`. */
export function absoluteName(path: string, name: string): string | null {
  const level = name.length - name.replace(/^\.+/, "").length;
  if (level === 0) return name;
  const base = relativeBase(path, level);
  return base === null ? null : `${base}.${name.slice(level)}`;
}

export interface ModuleEntry {
  path: string;
  /** Top-level name to its local id (`fn:x`, `cls:X`). */
  topLevel: Map<string, NodeId>;
  /** Local import name to its absolute full name. */
  aliases: Map<string, string>;
}

/** Project modules by dotted name. */
export type ModuleIndex = Map<string, ModuleEntry>;

export interface ParsedFile {
  path: string;
  root: Node;
}

export function buildModuleIndex(files: ParsedFile[]): ModuleIndex {
  const index: ModuleIndex = new Map();
  for (const { path, root } of files) {
    const name = moduleNameOf(path);
    if (name === null) continue;
    const aliases = new Map<string, string>();
    for (const [local, full] of importAliases(root)) {
      const absolute = absoluteName(path, full);
      if (absolute !== null) aliases.set(local, absolute);
    }
    index.set(name, {
      path,
      topLevel: allocateTopLevel(root).topLevel,
      aliases,
    });
  }
  return index;
}

/** Resolves an absolute dotted name whose last segment names a definition. */
function resolveAbsolute(
  index: ModuleIndex,
  name: string,
  visited: Set<string>,
): NodeId | null {
  if (visited.has(name)) return null;
  visited.add(name);
  const segments = name.split(".");
  for (let n = segments.length - 1; n >= 1; n--) {
    const entry = index.get(segments.slice(0, n).join("."));
    if (entry === undefined) continue;
    const last = segments[n];
    if (last === undefined || n !== segments.length - 1) return null;
    const local = entry.topLevel.get(last);
    if (local !== undefined) return childId(fileId(entry.path), local);
    const alias = entry.aliases.get(last);
    return alias === undefined
      ? null
      : resolveFrom(index, entry.path, alias, visited);
  }
  return null;
}

/** From the root first, then from the caller's folder. */
function resolveFrom(
  index: ModuleIndex,
  callerPath: string,
  dotted: string,
  visited: Set<string>,
): NodeId | null {
  const name = absoluteName(callerPath, dotted);
  if (name === null) return null;
  const pkg = packageOf(callerPath);
  const candidates = pkg === "" ? [name] : [name, `${pkg}.${name}`];
  for (const candidate of candidates) {
    const found = resolveAbsolute(index, candidate, visited);
    if (found !== null) return found;
  }
  return null;
}

/**
 * The project node a dotted name refers to, seen from `callerPath`
 * (PROJ-04), or null when the name is not a project definition.
 */
export function resolveName(
  index: ModuleIndex,
  callerPath: string,
  dotted: string,
): NodeId | null {
  return resolveFrom(index, callerPath, dotted, new Set());
}
