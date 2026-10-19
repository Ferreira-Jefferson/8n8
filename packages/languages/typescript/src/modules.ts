import { childId, fileId, type NodeId } from "@8n8/model";
import type { Node } from "web-tree-sitter";
import { allocateTopLevel, definitionOf } from "./build-graph";
import { importPath } from "./calls";
import { type Binding, importBindings, stringValue } from "./imports";

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

/** The files the plugin reads only as context: they name the packages and the `paths`, and give no graph. */
export const MANIFESTS = ["package.json", "tsconfig.json"];

export function isManifest(path: string): boolean {
  return MANIFESTS.includes(path.split("/").pop() ?? path);
}

/** A `package.json`: the name, and each `exports` key (`.`, `./x`, `./*`) with its targets; `types`, `module` and `main` go under `.`. */
export interface PackageInfo {
  name: string;
  entries: [string, string[]][];
}

/** The `paths` of a `tsconfig.json` (pattern to targets) and its `baseUrl`. */
export interface TsconfigInfo {
  baseUrl: string | null;
  paths: [string, string[]][];
}

/** A package of the workspace, by the folder of its `package.json`. */
export interface PackageEntry extends PackageInfo {
  dir: string;
}

/** A `tsconfig.json` with `paths`: the folder it judges, and the folder its targets start from. */
export interface TsconfigEntry {
  dir: string;
  base: string;
  paths: [string, string[]][];
}

/** What a specifier is resolved against: the project files and, when known, the workspace packages and the `paths`. */
export interface ModuleFiles {
  has(path: string): boolean;
  packages?: Map<string, PackageEntry>;
  /** The deepest folder first. */
  tsconfigs?: TsconfigEntry[];
}

/** The project file at `base`: as written, with `.ts`/`.tsx`, as a folder with `index`, or the `.ts` a `.js` stands for. */
function fileAt(base: string, files: ModuleFiles): string | null {
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

/** What the `*` of `pattern` takes in `text`: `""` for a pattern without `*` equal to the text; null when it does not match. */
function starMatch(pattern: string, text: string): string | null {
  const star = pattern.indexOf("*");
  if (star < 0) return pattern === text ? "" : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return text.length >= prefix.length + suffix.length &&
    text.startsWith(prefix) &&
    text.endsWith(suffix)
    ? text.slice(prefix.length, text.length - suffix.length)
    : null;
}

/** The first of `targets` (its `*` replaced by `star`) that is a project file, under `dir`. */
function firstFile(
  dir: string,
  targets: string[],
  star: string,
  files: ModuleFiles,
): string | null {
  for (const target of targets) {
    const base = join(dir, target.replace("*", star));
    const found = base === null || base === "" ? null : fileAt(base, files);
    if (found !== null) return found;
  }
  return null;
}

/** `@acme/core` and `@acme/core/x` of a workspace package: through `exports`, `types` or `main`, else `src/index` or `index`. */
function packageFile(specifier: string, files: ModuleFiles): string | null {
  const parts = specifier.split("/");
  const size = specifier.startsWith("@") ? 2 : 1;
  const pkg = files.packages?.get(parts.slice(0, size).join("/"));
  if (pkg === undefined) return null;
  const sub = parts.slice(size).join("/");
  const key = sub === "" ? "." : `./${sub}`;
  for (const [pattern, targets] of pkg.entries) {
    const star = starMatch(pattern, key);
    if (star === null) continue;
    const found = firstFile(pkg.dir, targets, star, files);
    if (found !== null) return found;
  }
  const fallback = sub === "" ? ["src/index", "index"] : [`src/${sub}`, sub];
  return firstFile(pkg.dir, fallback, "", files);
}

/** `@/x` through the `paths` of the nearest `tsconfig.json` that has them. */
function pathsFile(
  from: string,
  specifier: string,
  files: ModuleFiles,
): string | null {
  const config = files.tsconfigs?.find(
    (c) => c.dir === "" || from.startsWith(`${c.dir}/`),
  );
  for (const [pattern, targets] of config?.paths ?? []) {
    const star = starMatch(pattern, specifier);
    if (star === null) continue;
    const found = firstFile(config?.base ?? "", targets, star, files);
    if (found !== null) return found;
  }
  return null;
}

/**
 * The project file a specifier names, seen from `from`: `./x`, `../x`,
 * `./pasta` (to `pasta/index.ts`), with `.ts`/`.tsx`, without an extension,
 * or with the `.js` that stands for the `.ts` file; a `paths` alias of the
 * tsconfig; a package of the workspace. Null for any other package or a path
 * outside the project.
 */
export function resolveModulePath(
  from: string,
  specifier: string,
  files: ModuleFiles,
): string | null {
  if (!specifier.startsWith(".")) {
    return pathsFile(from, specifier, files) ?? packageFile(specifier, files);
  }
  const base = join(dirOf(from), specifier);
  if (base === null || base === "") return null;
  return fileAt(base, files);
}

/** What a file lets others import. */
export interface ExportInfo {
  /** Exported name to the local top-level name (`default` included). */
  names: Map<string, string>;
  /**
   * `export { a as b } from "./x"`, `export * from "./x"` (`name` is `*`)
   * and `export * as ns from "./x"` (`name` is `ns`, `imported` is `*`).
   */
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
    const namespace = statement.namedChildren.find(
      (c) => c.type === "namespace_export",
    );
    if (clause) {
      addClause(clause, info, from);
    } else if (namespace && from !== null) {
      const name = namespace.namedChildren[0]?.text;
      if (name) info.reexports.push({ name, imported: "*", from });
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

/** The class a class extends: its dotted name, and the import behind its first segment (null for a name of the file). */
export interface ClassBase {
  name: string;
  binding: Binding | null;
}

export interface ModuleEntry {
  path: string;
  /** Top-level name to its local id (`fn:x`, `cls:X`). */
  topLevel: Map<string, NodeId>;
  exports: ExportInfo;
}

interface ClassEntry {
  path: string;
  /** Own methods, by name, to their project ids. */
  methods: Map<string, NodeId>;
  base: ClassBase | null;
}

/** Project modules by path, the classes by project id, and what resolves a package or an alias. */
export interface ModuleIndex extends ModuleFiles {
  modules: Map<string, ModuleEntry>;
  classes: Map<NodeId, ClassEntry>;
  packages: Map<string, PackageEntry>;
  tsconfigs: TsconfigEntry[];
  /** Filled as the methods of each class (inherited ones included) are asked for. */
  methods: Map<NodeId, Map<string, NodeId>>;
}

/** What one source file adds to the project: its top-level names, its exports and its classes, as plain JSON (the core keeps it on disk). */
export interface ModuleContribution {
  topLevel: [string, NodeId][];
  names: [string, string][];
  reexports: ExportInfo["reexports"];
  /** Each class: its local id, its methods (name, id under the class) and the class it extends. */
  classes: [NodeId, [string, NodeId][], ClassBase | null][];
}

/** What a file adds: a source file, a `package.json` or a `tsconfig.json` (null when its text is not one). */
export type Contribution =
  | ModuleContribution
  | { package: PackageInfo | null }
  | { tsconfig: TsconfigInfo | null };

/** The contribution of one file: it depends only on the text. */
export function contributionOf(root: Node): ModuleContribution {
  const { names, reexports } = exportInfo(root);
  const top = allocateTopLevel(root);
  const aliases = importBindings(root);
  return {
    topLevel: [...top.topLevel],
    names: [...names],
    reexports,
    classes: [...top.classes].map(([id, c]) => [
      id,
      [...c.methods],
      c.base === null
        ? null
        : {
            name: c.base,
            binding: aliases.get(c.base.split(".")[0] ?? "") ?? null,
          },
    ]),
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The strings of an `exports` value, conditions and arrays in order. */
function targetsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(targetsOf);
  return isObject(value) ? Object.values(value).flatMap(targetsOf) : [];
}

/** The name and the entry points of a `package.json`; null when the text is not one. */
export function packageInfo(text: string): PackageInfo | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(json) || typeof json.name !== "string") return null;
  const entries: [string, string[]][] = [];
  const { exports } = json;
  if (
    isObject(exports) &&
    Object.keys(exports).some((k) => k.startsWith("."))
  ) {
    for (const [key, value] of Object.entries(exports)) {
      if (key.startsWith(".")) entries.push([key, targetsOf(value)]);
    }
  } else if (exports !== undefined) {
    entries.push([".", targetsOf(exports)]);
  }
  const root = ["types", "typings", "module", "main"].flatMap((key) => {
    const value = json[key];
    return typeof value === "string" ? [value] : [];
  });
  if (root.length > 0) entries.push([".", root]);
  return { name: json.name, entries };
}

/** JSON with the `//` and `/* *\/` comments and the trailing commas a tsconfig allows. */
function parseJsonc(text: string): unknown {
  let out = "";
  for (let i = 0; i < text.length; ) {
    const c = text[i] as string;
    if (c === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') {
        end += text[end] === "\\" ? 2 : 1;
      }
      out += text.slice(i, end + 1);
      i = end + 1;
    } else if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === "," && /^\s*[}\]]/.test(text.slice(i + 1, i + 200))) {
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out);
}

/** The `paths` and `baseUrl` of a `tsconfig.json`; null when it has no `paths` or the text is not one. */
export function tsconfigInfo(text: string): TsconfigInfo | null {
  let json: unknown;
  try {
    json = parseJsonc(text);
  } catch {
    return null;
  }
  const options = isObject(json) ? json.compilerOptions : undefined;
  if (!isObject(options) || !isObject(options.paths)) return null;
  const paths: [string, string[]][] = Object.entries(options.paths).map(
    ([pattern, targets]) => [pattern, targetsOf(targets)],
  );
  const { baseUrl } = options;
  return { baseUrl: typeof baseUrl === "string" ? baseUrl : null, paths };
}

/** The contribution of a manifest: it depends only on the path and the text. */
export function manifestContribution(path: string, text: string): Contribution {
  return path.endsWith("package.json")
    ? { package: packageInfo(text) }
    : { tsconfig: tsconfigInfo(text) };
}

/** A pattern without `*` first, then the longest prefix, as TypeScript picks the most specific pattern. */
function byPrefix(a: [string, string[]], b: [string, string[]]): number {
  const rank = (p: string) =>
    p.includes("*") ? p.indexOf("*") : Number.MAX_SAFE_INTEGER;
  return rank(b[0]) - rank(a[0]);
}

export function indexOfContributions(
  contributions: { path: string; data: Contribution }[],
): ModuleIndex {
  const modules = new Map<string, ModuleEntry>();
  const classes = new Map<NodeId, ClassEntry>();
  const packages = new Map<string, PackageEntry>();
  const tsconfigs: TsconfigEntry[] = [];
  for (const { path, data } of contributions) {
    if ("package" in data) {
      if (data.package !== null && !packages.has(data.package.name)) {
        packages.set(data.package.name, { ...data.package, dir: dirOf(path) });
      }
      continue;
    }
    if ("tsconfig" in data) {
      const config = data.tsconfig;
      const dir = dirOf(path);
      const base = join(dir, config?.baseUrl ?? ".");
      if (config !== null && base !== null) {
        tsconfigs.push({ dir, base, paths: [...config.paths].sort(byPrefix) });
      }
      continue;
    }
    modules.set(path, {
      path,
      topLevel: new Map(data.topLevel),
      exports: { names: new Map(data.names), reexports: data.reexports },
    });
    const file = fileId(path);
    for (const [id, methods, base] of data.classes) {
      classes.set(childId(file, id), {
        path,
        methods: new Map(methods.map(([name, m]) => [name, childId(file, m)])),
        base,
      });
    }
  }
  tsconfigs.sort((a, b) => b.dir.length - a.dir.length);
  return {
    has: (path) => modules.has(path),
    modules,
    classes,
    packages,
    tsconfigs,
    methods: new Map(),
  };
}

export function buildModuleIndex(
  files: { path: string; root: Node }[],
): ModuleIndex {
  return indexOfContributions(
    files.map(({ path, root }) => ({ path, data: contributionOf(root) })),
  );
}

function moduleAt(
  index: ModuleIndex,
  from: string,
  specifier: string,
): ModuleEntry | undefined {
  const path = resolveModulePath(from, specifier, index);
  return path === null ? undefined : index.modules.get(path);
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
    if (re.imported === "*" && re.name !== "*") continue;
    if (re.name !== name && !(re.name === "*" && name !== "default")) continue;
    const target = moduleAt(index, entry.path, re.from);
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

/** The module that `entry` exports as the namespace `name` (`export * as name from`), following re-exports. */
function resolveNamespace(
  index: ModuleIndex,
  entry: ModuleEntry,
  name: string,
  visited: Set<string>,
): ModuleEntry | null {
  const key = `${entry.path}#${name}`;
  if (visited.has(key)) return null;
  visited.add(key);
  for (const re of entry.exports.reexports) {
    const target = moduleAt(index, entry.path, re.from);
    if (target === undefined) continue;
    if (re.name === name && re.imported === "*") return target;
    if (re.imported === "*" && re.name !== "*") continue;
    if (re.name !== name && !(re.name === "*" && name !== "default")) continue;
    const found = resolveNamespace(
      index,
      target,
      re.name === "*" ? name : re.imported,
      visited,
    );
    if (found !== null) return found;
  }
  return null;
}

/** The class a class of `path` extends, as a project id; null when it is not a project class. */
function baseClass(
  index: ModuleIndex,
  path: string,
  base: ClassBase,
): NodeId | null {
  if (base.binding === null) {
    const id = index.modules.get(path)?.topLevel.get(base.name);
    return id === undefined ? null : childId(fileId(path), id);
  }
  return resolveMember(
    index,
    path,
    base.binding,
    importPath(base.binding, base.name.split(".").slice(1)),
  );
}

/** The methods of a project class by name, the inherited ones under its own. Empty for anything that is not a project class. */
export function methodsOf(
  index: ModuleIndex,
  classId: NodeId,
  seen: Set<NodeId> = new Set(),
): Map<string, NodeId> {
  const cached = index.methods.get(classId);
  if (cached !== undefined) return cached;
  const cls = index.classes.get(classId);
  if (cls === undefined || seen.has(classId)) return new Map();
  seen.add(classId);
  const baseId =
    cls.base === null ? null : baseClass(index, cls.path, cls.base);
  const methods = new Map([
    ...(baseId === null ? [] : methodsOf(index, baseId, seen)),
    ...cls.methods,
  ]);
  index.methods.set(classId, methods);
  return methods;
}

/** The node behind `path` read from `entry`: an export, the method of an exported class, or a name inside an `export * as`. */
function resolvePath(
  index: ModuleIndex,
  entry: ModuleEntry,
  path: string[],
): NodeId | null {
  const [name, ...rest] = path;
  if (name === undefined) return null;
  const found = resolveExport(index, entry, name, new Set());
  if (rest.length === 0) return found;
  if (found !== null) {
    return rest.length === 1
      ? (methodsOf(index, found).get(rest[0] ?? "") ?? null)
      : null;
  }
  const namespace = resolveNamespace(index, entry, name, new Set());
  return namespace === null ? null : resolvePath(index, namespace, rest);
}

/**
 * The project node behind the names `path` read through `binding` (see
 * `importPath`), seen from `callerPath`; null when the specifier is not a
 * project file or does not lead to a node.
 */
export function resolveMember(
  index: ModuleIndex,
  callerPath: string,
  binding: Binding,
  path: string[],
): NodeId | null {
  const entry = moduleAt(index, callerPath, binding.module);
  return entry === undefined ? null : resolvePath(index, entry, path);
}
