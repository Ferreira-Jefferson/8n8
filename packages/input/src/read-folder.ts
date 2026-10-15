import { basename, join, resolve } from "node:path";
import type { IgnoredFile, SourceFile } from "@8n8/model";
import ignore, { type Ignore } from "ignore";
import { readdir, readFile, realpath, stat } from "./fs-read";
import { readSourceFile } from "./read-file";

/** Folders no language wants; each plugin adds its own through `ReadFilter.ignoredDirs`. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "build",
  "dist",
]);

/** What to read: the files of these extensions (with the dot, any case), skipping these folders besides `IGNORED_DIRS`. */
export interface ReadFilter {
  extensions: string[];
  ignoredDirs: string[];
  /** Files over 1 MB the person put on the map, relative POSIX paths (CLEAN-06). */
  include?: string[];
}

export type FolderRead =
  | {
      kind: "ok";
      name: string;
      root: string;
      files: SourceFile[];
      ignored: IgnoredFile[];
    }
  | { kind: "not-found" };

/** The folder's own name, or the whole path for a disk root (`C:\`, `/`). */
export function folderName(root: string): string {
  return basename(root) || root;
}

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export async function readSourceFolder(
  path: string,
  { extensions, ignoredDirs, include = [] }: ReadFilter,
): Promise<FolderRead> {
  const added = new Set(include);
  const wanted = extensions.map((e) => e.toLowerCase());
  const skipped = new Set([...IGNORED_DIRS, ...ignoredDirs]);
  let root: string;
  try {
    root = await realpath(resolve(path));
    if (!(await stat(root)).isDirectory()) return { kind: "not-found" };
  } catch {
    return { kind: "not-found" };
  }

  const files: SourceFile[] = [];
  const ignored: IgnoredFile[] = [];

  async function walk(
    abs: string,
    rel: string,
    rules: GitignoreRules[],
  ): Promise<void> {
    const entries = await readdir(abs, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => byCode(a.name, b.name));
    // This folder's .gitignore applies to it and below, after the ones above (CLEAN-01).
    const own = await gitignoreOf(abs, rel);
    const active = own ? [...rules, own] : rules;
    for (const entry of entries) {
      const entryAbs = join(abs, entry.name);
      const entryRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const isDir = entry.isDirectory();
      if (gitignored(active, entryRel, isDir)) continue;
      if (entry.isSymbolicLink() || entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (!wanted.some((e) => name.endsWith(e))) continue;
        const read = await readSourceFile(
          entryAbs,
          entryRel,
          added.has(entryRel),
        );
        if (read.kind === "ok") files.push(read.file);
        else ignored.push(read.ignored);
      } else if (isDir && !skipped.has(entry.name)) {
        await walk(entryAbs, entryRel, active);
      }
    }
  }

  await walk(root, "", []);
  ignored.sort((a, b) => byCode(a.path, b.path));
  return { kind: "ok", name: folderName(root), root, files, ignored };
}

/** The rules of one .gitignore and the folder they live in ("" for the root). */
interface GitignoreRules {
  base: string;
  rules: Ignore;
}

/** The .gitignore of a folder, or undefined when it has none. */
async function gitignoreOf(
  abs: string,
  rel: string,
): Promise<GitignoreRules | undefined> {
  try {
    const text = await readFile(join(abs, ".gitignore"), "utf8");
    return { base: rel, rules: ignore().add(text) };
  } catch {
    return undefined;
  }
}

/**
 * Whether git would ignore the path: each .gitignore from the root down judges the
 * path relative to its folder, and a deeper file's `!` wins over an upper one.
 */
function gitignored(
  stack: GitignoreRules[],
  rel: string,
  isDir: boolean,
): boolean {
  let ignored = false;
  for (const { base, rules } of stack) {
    const inside = base === "" ? rel : rel.slice(base.length + 1);
    const verdict = rules.test(isDir ? `${inside}/` : inside);
    if (verdict.ignored) ignored = true;
    else if (verdict.unignored) ignored = false;
  }
  return ignored;
}
