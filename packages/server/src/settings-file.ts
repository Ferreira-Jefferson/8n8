import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname } from "node:path";
import { type StoredSettings, THEMES } from "@8n8/model";
import { z } from "zod";
import type { SettingsStore } from "./settings";

const fileSchema = z.object({
  provider: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  autoSummary: z.boolean().optional(),
  autoSuggestions: z.boolean().optional(),
  theme: z.enum(THEMES).optional(),
});

/** The file operations the store uses; tests inject failing ones. */
export interface FileOps {
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  writeFile: (
    path: string,
    data: string,
    options: { encoding: "utf8"; mode: number },
  ) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  rm: (path: string, options: { force: boolean }) => Promise<void>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<unknown>;
}

const NODE_FS: FileOps = {
  readFile: (path, encoding) => fs.readFile(path, encoding),
  writeFile: (path, data, options) => fs.writeFile(path, data, options),
  rename: (from, to) => fs.rename(from, to),
  rm: (path, options) => fs.rm(path, options),
  mkdir: (path, options) => fs.mkdir(path, options),
};

/** On Windows a file another program holds for a moment (antivirus, indexer) refuses the rename. */
const BUSY = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_TRIES = 10;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Renames, retrying a busy target for about one second in all. */
async function renameWithRetry(
  ops: FileOps,
  from: string,
  to: string,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await ops.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!BUSY.has(code) || attempt >= RENAME_TRIES) throw err;
      await pause(Math.min(20 * attempt, 200));
    }
  }
}

/**
 * The settings as one JSON file. A missing, unreadable or malformed file reads as
 * empty settings; a write goes to a temporary file with owner-only permission and
 * replaces the file in one rename, so a failed write never leaves half a file (CFG-19).
 */
export function createFileSettingsStore(
  path: string,
  ops: FileOps = NODE_FS,
): SettingsStore {
  return {
    async read() {
      try {
        const parsed = fileSchema.safeParse(
          JSON.parse(await ops.readFile(path, "utf8")),
        );
        return parsed.success ? (parsed.data as StoredSettings) : {};
      } catch {
        return {};
      }
    },
    async write(settings) {
      await ops.mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${randomUUID()}.tmp`;
      try {
        await ops.writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        await renameWithRetry(ops, tmp, path);
      } catch (err) {
        await ops.rm(tmp, { force: true }).catch(() => {});
        throw err;
      }
    },
  };
}
