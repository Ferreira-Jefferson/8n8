import { childId, fileId, type NodeId } from "@8n8/model";
import type { Node } from "web-tree-sitter";
import { allocateTopLevel, classMethodsOf } from "./build-graph";
import {
  allNames,
  importAliases,
  type StarImports,
  starModules,
} from "./imports";
import { type RouterFacts, routerFactsOf } from "./links";

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
  /** Modules of its `from x import *`, as written. */
  stars: string[];
  /** The names of its `__all__`, or null without a plain one. */
  all: string[] | null;
  /** Top-level class name to its methods, by name, with local ids (`cls:X/fn:m`). */
  classes: Map<string, Map<string, NodeId>>;
}

/** Project modules by dotted name. */
export type ModuleIndex = Map<string, ModuleEntry>;

export interface ParsedFile {
  path: string;
  root: Node;
}

/** What one file adds to the project: its top-level names and its import aliases, as plain JSON (the core keeps it on disk). */
export interface ModuleContribution {
  topLevel: [string, NodeId][];
  aliases: [string, string][];
  stars: string[];
  all: string[] | null;
  routes: RouterFacts;
  classes: [string, [string, NodeId][]][];
}

/** The contribution of one file: it depends only on the path and the text. */
export function contributionOf(path: string, root: Node): ModuleContribution {
  const aliases: [string, string][] = [];
  for (const [local, full] of importAliases(root)) {
    const absolute = absoluteName(path, full);
    if (absolute !== null) aliases.push([local, absolute]);
  }
  const top = allocateTopLevel(root);
  return {
    topLevel: [...top.topLevel],
    aliases,
    stars: starModules(root),
    all: allNames(root),
    routes: routerFactsOf(moduleNameOf(path) ?? "", root, new Map(aliases)),
    classes: [...classMethodsOf(root, top)].map(([name, methods]) => [
      name,
      [...methods],
    ]),
  };
}

/** The index of the contributions, in the order given: a module name that two files share goes to the last one. */
export function indexOfContributions(
  contributions: { path: string; data: ModuleContribution }[],
): ModuleIndex {
  const index: ModuleIndex = new Map();
  for (const { path, data } of contributions) {
    const name = moduleNameOf(path);
    if (name === null) continue;
    index.set(name, {
      path,
      topLevel: new Map(data.topLevel),
      aliases: new Map(data.aliases),
      stars: data.stars,
      all: data.all,
      classes: new Map(
        data.classes.map(([name, methods]) => [name, new Map(methods)]),
      ),
    });
  }
  return index;
}

export function buildModuleIndex(files: ParsedFile[]): ModuleIndex {
  return indexOfContributions(
    files.map(({ path, root }) => ({ path, data: contributionOf(path, root) })),
  );
}

/** Resolves an absolute dotted name whose last segment names a definition, or a method of a class (`m.Class.method`). */
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
    const member = n === segments.length - 2 ? segments[n + 1] : undefined;
    if (last === undefined) return null;
    if (member !== undefined) {
      const method = entry.classes.get(last)?.get(member);
      if (method !== undefined) return childId(fileId(entry.path), method);
      const alias = entry.aliases.get(last);
      return alias === undefined
        ? null
        : resolveFrom(index, entry.path, `${alias}.${member}`, visited);
    }
    if (n !== segments.length - 1) return null;
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

/** The project module a dotted name refers to, seen from `callerPath`, with its absolute name. */
function moduleEntry(
  index: ModuleIndex,
  callerPath: string,
  dotted: string,
): [string, ModuleEntry] | null {
  // `from . import *` names the package itself.
  const name = absoluteName(callerPath, dotted)?.replace(/\.$/, "");
  if (name === undefined) return null;
  const pkg = packageOf(callerPath);
  for (const candidate of pkg === "" ? [name] : [name, `${pkg}.${name}`]) {
    const entry = index.get(candidate);
    if (entry !== undefined) return [candidate, entry];
  }
  return null;
}

/** An absolute `module.name` seen from `callerPath`, under the module the project has: the root first, then the caller's folder. */
export function canonicalName(
  index: ModuleIndex,
  callerPath: string,
  full: string,
): string {
  const pkg = packageOf(callerPath);
  for (const candidate of pkg === "" ? [full] : [full, `${pkg}.${full}`]) {
    if (index.has(candidate.split(".").slice(0, -1).join("."))) {
      return candidate;
    }
  }
  return full;
}

/**
 * The names that the `from x import *` of a file bring from project modules: the `__all__` of the module, or its
 * public top-level and imported names, and those of its own `*` imports. A later `*` wins, as in Python.
 */
export function starImports(
  index: ModuleIndex,
  callerPath: string,
  stars: string[],
  seen: Set<string> = new Set(),
): StarImports {
  const aliases = new Map<string, string>();
  let open = false;
  for (const star of stars) {
    const found = moduleEntry(index, callerPath, star);
    if (found === null) {
      open ||= star.startsWith(".");
      continue;
    }
    const [name, entry] = found;
    if (seen.has(name)) continue;
    seen.add(name);
    const nested = starImports(index, entry.path, entry.stars, seen);
    open ||= nested.open;
    const own = (n: string) => entry.topLevel.has(n) || entry.aliases.has(n);
    const names =
      entry.all ??
      [
        ...entry.topLevel.keys(),
        ...entry.aliases.keys(),
        ...nested.aliases.keys(),
      ].filter((n) => !n.startsWith("_"));
    for (const n of names) {
      const full = own(n) ? `${name}.${n}` : nested.aliases.get(n);
      if (full !== undefined) aliases.set(n, full);
    }
  }
  return { aliases, open };
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
