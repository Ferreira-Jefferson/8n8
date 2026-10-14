import { childId, fileId, type NodeId } from "@code2n8n/model";
import type { Node } from "web-tree-sitter";
import { allocateTopLevel, definitionOf } from "./build-graph";
import { type Binding, stringValue } from "./imports";

function dirOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

/** `base` + `spec` as a POSIX path without `.` and `..`; null above the root. */
function join(base: string, spec: string): string | null {
  const out = base === "" ? [] : base.split("/");
  for (const part of spec.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join("/");
}

/**
 * The project file a relative specifier names, seen from `from`: `./x`,
 * `../x`, `./pasta` (to `pasta/index.ts`), with `.ts`/`.tsx`, without an
 * extension, or with the `.js` that stands for the `.ts` file. Null for a
 * package or a path outside the project.
 */
export function resolveModulePath(
  from: string,
  specifier: string,
  files: { has(path: string): boolean },
): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = join(dirOf(from), specifier);
  if (base === null || base === "") return null;
  const js = /\.(?:js|jsx|mjs|cjs)$/.exec(base);
  const candidates = js
    ? [base, `${base.slice(0, js.index)}.ts`, `${base.slice(0, js.index)}.tsx`]
    : [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
      ];
  return candidates.find((c) => files.has(c)) ?? null;
}

/** What a file lets others import. */
export interface ExportInfo {
  /** Exported name to the local top-level name (`default` included). */
  names: Map<string, string>;
  /** `export { a as b } from "./x"` and `export * from "./x"` (`name` is `*`). */
  reexports: { name: string; imported: string; from: string }[];
}

function addClause(clause: Node, info: ExportInfo, from: string | null): void {
  for (const spec of clause.namedChildren) {
    const name = spec.childForFieldName("name")?.text;
    if (name === undefined) continue;
    const exported = spec.childForFieldName("alias")?.text ?? name;
    if (from === null) info.names.set(exported, name);
    else info.reexports.push({ name: exported, imported: name, from });
  }
}

export function exportInfo(root: Node): ExportInfo {
  const info: ExportInfo = { names: new Map(), reexports: [] };
  for (const statement of root.namedChildren) {
    if (statement.type !== "export_statement") continue;
    const isDefault = statement.children.some((c) => c.type === "default");
    const from = stringValue(statement.childForFieldName("source"));
    const clause = statement.namedChildren.find(
      (c) => c.type === "export_clause",
    );
    if (clause) {
      addClause(clause, info, from);
    } else if (from !== null) {
      info.reexports.push({ name: "*", imported: "*", from });
    }
    const def = definitionOf(statement);
    if (def !== null) {
      info.names.set(def.name, def.name);
      if (isDefault) info.names.set("default", def.name);
    } else if (isDefault) {
      const value = statement.childForFieldName("value");
      if (value?.type === "identifier") info.names.set("default", value.text);
    }
    // `export const a = 1, b = 2;` and `export enum E {}`: plain names.
    const declaration = statement.childForFieldName("declaration");
    if (declaration && def === null) {
      for (const d of declaration.namedChildren) {
        const name = d.childForFieldName("name");
        if (name?.type === "identifier") info.names.set(name.text, name.text);
      }
    }
  }
  return info;
}

export interface ModuleEntry {
  path: string;
  /** Top-level name to its local id (`fn:x`, `cls:X`). */
  topLevel: Map<string, NodeId>;
  exports: ExportInfo;
}

/** Project modules by path. */
export type ModuleIndex = Map<string, ModuleEntry>;

export function buildModuleIndex(
  files: { path: string; root: Node }[],
): ModuleIndex {
  const index: ModuleIndex = new Map();
  for (const { path, root } of files) {
    index.set(path, {
      path,
      topLevel: allocateTopLevel(root).topLevel,
      exports: exportInfo(root),
    });
  }
  return index;
}

/** The project node that `entry` exports as `name`, following re-exports. */
function resolveExport(
  index: ModuleIndex,
  entry: ModuleEntry,
  name: string,
  visited: Set<string>,
): NodeId | null {
  const key = `${entry.path}#${name}`;
  if (visited.has(key)) return null;
  visited.add(key);
  const local = entry.exports.names.get(name);
  const id = entry.topLevel.get(local ?? name);
  if (id !== undefined) return childId(fileId(entry.path), id);
  for (const re of entry.exports.reexports) {
    if (re.name !== name && !(re.name === "*" && name !== "default")) continue;
    const path = resolveModulePath(entry.path, re.from, index);
    const target = path === null ? undefined : index.get(path);
    if (target === undefined) continue;
    const found = resolveExport(
      index,
      target,
      re.name === "*" ? name : re.imported,
      visited,
    );
    if (found !== null) return found;
  }
  return null;
}

/**
 * The project node behind an import of `member` through `binding`, seen
 * from `callerPath`; null when the specifier is not a project file or does
 * not export that name.
 */
export function resolveMember(
  index: ModuleIndex,
  callerPath: string,
  binding: Binding,
  member: string,
): NodeId | null {
  const path = resolveModulePath(callerPath, binding.module, index);
  const entry = path === null ? undefined : index.get(path);
  return entry === undefined
    ? null
    : resolveExport(index, entry, member, new Set());
}
