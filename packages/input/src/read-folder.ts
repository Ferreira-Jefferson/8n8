import { basename, join, resolve } from "node:path";
import type { IgnoredFile, SourceFile } from "@code2n8n/model";
import { readdir, realpath, stat } from "./fs-read";
import { readSourceFile } from "./read-file";

export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  ".git",
  ".venv",
  "venv",
  "node_modules",
  "__pycache__",
  "site-packages",
  "build",
  "dist",
]);

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
  extension: string,
): Promise<FolderRead> {
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
        if (!entry.name.endsWith(extension)) continue;
        const read = await readSourceFile(entryAbs, entryRel);
        if (read.kind === "ok") files.push(read.file);
        else ignored.push(read.ignored);
      } else if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
        await walk(entryAbs, entryRel);
      }
    }
  }

  await walk(root, "");
  ignored.sort((a, b) => byCode(a.path, b.path));
  return { kind: "ok", name: folderName(root), root, files, ignored };
}
