import { basename, join, resolve } from "node:path";
import type { IgnoredFile, SourceFile } from "@8n8/model";
import { readdir, realpath, stat } from "./fs-read";
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
  { extensions, ignoredDirs }: ReadFilter,
): Promise<FolderRead> {
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

  async function walk(abs: string, rel: string): Promise<void> {
    const entries = await readdir(abs, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => byCode(a.name, b.name));
    for (const entry of entries) {
      const entryAbs = join(abs, entry.name);
      const entryRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isSymbolicLink() || entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (!wanted.some((e) => name.endsWith(e))) continue;
        const read = await readSourceFile(entryAbs, entryRel);
        if (read.kind === "ok") files.push(read.file);
        else ignored.push(read.ignored);
      } else if (entry.isDirectory() && !skipped.has(entry.name)) {
        await walk(entryAbs, entryRel);
      }
    }
  }

  await walk(root, "");
  ignored.sort((a, b) => byCode(a.path, b.path));
  return { kind: "ok", name: folderName(root), root, files, ignored };
}
