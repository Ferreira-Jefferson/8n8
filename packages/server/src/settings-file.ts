import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StoredSettings } from "@8n8/model";
import { z } from "zod";
import type { SettingsStore } from "./settings";

const fileSchema = z.object({
  provider: z.string().optional(),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  model: z.string().optional(),
  autoSummary: z.boolean().optional(),
  autoSuggestions: z.boolean().optional(),
});

/**
 * The settings as one JSON file. A missing, unreadable or malformed file reads as
 * empty settings; a write goes to a temporary file with owner-only permission and
 * replaces the file in one rename (CFG-19).
 */
export function createFileSettingsStore(path: string): SettingsStore {
  return {
    async read() {
      try {
        const parsed = fileSchema.safeParse(
          JSON.parse(await readFile(path, "utf8")),
        );
        return parsed.success ? (parsed.data as StoredSettings) : {};
      } catch {
        return {};
      }
    },
    async write(settings) {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${randomUUID()}.tmp`;
      await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(tmp, path);
    },
  };
}
