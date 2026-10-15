import type { IgnoredFile, SourceFile } from "@8n8/model";
import { lstat, readFile } from "./fs-read";

const MAX_FILE_BYTES = 1_048_576;
/** A file the person asks for may reach 20 MB; past that it never enters the map (CLEAN-06). */
const MAX_ADDED_BYTES = 20 * 1_048_576;

export type FileRead =
  | { kind: "ok"; file: SourceFile }
  | { kind: "ignored"; ignored: IgnoredFile };

/** Reads one file as UTF-8 text; `rel` is reported in POSIX form. `added` lifts the 1 MB limit to 20 MB. */
export async function readSourceFile(
  abs: string,
  rel: string,
  added = false,
): Promise<FileRead> {
  const path = rel.replaceAll("\\", "/");
  const ignore = (
    reason: IgnoredFile["reason"],
    extra: Partial<IgnoredFile> = {},
  ): FileRead => ({
    kind: "ignored",
    ignored: { path, reason, ...extra },
  });
  try {
    const info = await lstat(abs);
    if (info.isSymbolicLink()) return ignore("symlink");
    if (
      info.size > MAX_FILE_BYTES &&
      !(added && info.size <= MAX_ADDED_BYTES)
    ) {
      return ignore("too-large", { addable: info.size <= MAX_ADDED_BYTES });
    }
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
