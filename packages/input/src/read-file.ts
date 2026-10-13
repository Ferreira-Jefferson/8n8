import type { IgnoredFile, SourceFile } from "@code2n8n/model";
import { lstat, readFile } from "./fs-read";

export const MAX_FILE_BYTES = 1_048_576;

export type FileRead =
  | { kind: "ok"; file: SourceFile }
  | { kind: "ignored"; ignored: IgnoredFile };

/** Reads one file as UTF-8 text; `rel` is reported in POSIX form. */
export async function readSourceFile(
  abs: string,
  rel: string,
): Promise<FileRead> {
  const path = rel.replaceAll("\\", "/");
  const ignore = (reason: IgnoredFile["reason"]): FileRead => ({
    kind: "ignored",
    ignored: { path, reason },
  });
  try {
    const info = await lstat(abs);
    if (info.isSymbolicLink()) return ignore("symlink");
    if (info.size > MAX_FILE_BYTES) return ignore("too-large");
    const bytes = await readFile(abs);
    try {
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { kind: "ok", file: { path, source } };
    } catch {
      return ignore("not-utf8");
    }
  } catch {
    return ignore("unreadable");
  }
}
