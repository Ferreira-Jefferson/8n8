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

/** Never read, whatever the settings say: version control is no dependency, but nobody maps it. */
const ALWAYS_SKIPPED: ReadonlySet<string> = new Set([".git"]);

/** Build outputs are skipped inside a folder, but a project may sit under one (`/srv/dist/app`). */
const OUTPUT_DIRS: ReadonlySet<string> = new Set(["build", "dist"]);

/** What to read: the files of these extensions (with the dot, any case), skipping these folders besides `IGNORED_DIRS`. */
export interface ReadFilter {
  extensions: string[];
  /** Files read by their exact name too, as `package.json` (the plugins' manifests). */
  names?: string[];
  ignoredDirs: string[];
  /** Files over 1 MB the person put on the map, relative POSIX paths (CLEAN-06). */
  include?: string[];
  /** Skip what the .gitignore files ignore and the dependency folders (node_modules, .venv…), also as the folder or file opened; true unless set to false. */
  ignoreDependencies?: boolean;
}

export type FolderRead =
  | {
      kind: "ok";
      name: string;
      root: string;
      files: SourceFile[];
      ignored: IgnoredFile[];
    }
  /** `dependency`: the path is, or lies inside, a dependency folder the settings skip. */
  | { kind: "not-found"; dependency?: true };

/** The folder's own name, or the whole path for a disk root (`C:\`, `/`). */
export function folderName(root: string): string {
  return basename(root) || root;
}

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export async function readSourceFolder(
  path: string,
  {
    extensions,
    names = [],
    ignoredDirs,
    include = [],
    ignoreDependencies = true,
  }: ReadFilter,
): Promise<FolderRead> {
  const added = new Set(include);
  const wanted = extensions.map((e) => e.toLowerCase());
  const skipped = ignoreDependencies
    ? new Set([...IGNORED_DIRS, ...ignoredDirs])
    : new Set(ALWAYS_SKIPPED);
  let root: string;
  try {
    root = await realpath(resolve(path));
    if (ignoreDependencies && insideDependency(root, skipped)) {
      return { kind: "not-found", dependency: true };
    }
    const info = await stat(root);
    // A file is a map of one file: its own path is the root, so a re-read finds only it.
    if (info.isFile()) {
      const name = basename(root);
      if (!wanted.some((e) => name.toLowerCase().endsWith(e))) {
        return { kind: "not-found" };
      }
      const read = await readSourceFile(root, name, added.has(name));
      return {
        kind: "ok",
        name,
        root,
        files: read.kind === "ok" ? [read.file] : [],
        ignored: read.kind === "ok" ? [] : [read.ignored],
      };
    }
    if (!info.isDirectory()) return { kind: "not-found" };
  } catch {
    return { kind: "not-found" };
  }

  const turn = limited(OPEN_AT_ONCE);

  /** What a folder holds, in the order of its sorted entries: the files it reads while the others are still being read. */
  async function walk(
    abs: string,
    rel: string,
    rules: GitignoreRules[],
  ): Promise<Found> {
    const entries = await turn(() =>
      readdir(abs, { withFileTypes: true }).catch(() => []),
    );
    entries.sort((a, b) => byCode(a.name, b.name));
    // This folder's .gitignore applies to it and below, after the ones above (CLEAN-01).
    const own = ignoreDependencies
      ? await turn(() => gitignoreOf(abs, rel))
      : undefined;
    const active = own ? [...rules, own] : rules;
    const jobs: Promise<Found>[] = [];
    for (const entry of entries) {
      const entryAbs = join(abs, entry.name);
      const entryRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const isDir = entry.isDirectory();
      if (gitignored(active, entryRel, isDir)) continue;
      if (entry.isSymbolicLink() || entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (
          !wanted.some((e) => name.endsWith(e)) &&
          !names.includes(entry.name)
        )
          continue;
        jobs.push(
          turn(() =>
            readSourceFile(entryAbs, entryRel, added.has(entryRel)),
          ).then((read) =>
            read.kind === "ok"
              ? { files: [read.file], ignored: [] }
              : { files: [], ignored: [read.ignored] },
          ),
        );
      } else if (isDir && !skipped.has(entry.name)) {
        jobs.push(walk(entryAbs, entryRel, active));
      }
    }
    const found: Found = { files: [], ignored: [] };
    for (const part of await Promise.all(jobs)) {
      for (const file of part.files) found.files.push(file);
      for (const skip of part.ignored) found.ignored.push(skip);
    }
    return found;
  }

  const { files, ignored } = await walk(root, "", []);
  ignored.sort((a, b) => byCode(a.path, b.path));
  return { kind: "ok", name: folderName(root), root, files, ignored };
}

/** The files and the ignored files of a folder. */
interface Found {
  files: SourceFile[];
  ignored: IgnoredFile[];
}

/** How many disk calls are open at once: reading one file after the other waits for the disk 3 000 times. */
const OPEN_AT_ONCE = 32;

/** Runs the tasks it is given, at most `max` at a time, each as soon as a place is free. */
function limited(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    // A task that leaves hands its place to the next one that waits, so no newcomer takes it first.
    if (active >= max) await new Promise<void>((go) => waiting.push(go));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/** Whether a folder on the path is one the walk skips: opening it directly would map what the walk never reads. */
function insideDependency(root: string, skipped: ReadonlySet<string>): boolean {
  return root
    .split(/[\\/]/)
    .some(
      (part) =>
        skipped.has(part) &&
        !ALWAYS_SKIPPED.has(part) &&
        !OUTPUT_DIRS.has(part),
    );
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
