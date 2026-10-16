import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ChatSuggestion,
  DEFAULT_LOCALE,
  type Locale,
  type NodeId,
  suggestionKey,
} from "@8n8/model";
import { z } from "zod";
import { folderOf } from "./cache";
import { normalizeCode } from "./fingerprint";

/** A suggestion kept from the chat, with its line RELATIVE to the node, like the cache (CACHE-05). */
export interface SavedItem {
  id: string;
  command: string;
  reason: string;
  line: number;
  severity: ChatSuggestion["severity"];
}

/** What the person did with the suggestions of one node, as the disk keeps it. */
export interface StoredNotes {
  saved: SavedItem[];
  dismissed: string[];
}

export interface NotesStore {
  /** What was kept for the node; nothing when its code changed since (the lines would point elsewhere). */
  get(nodeId: NodeId, code: string): Promise<StoredNotes>;
  /** Reads, changes and writes in one turn: two requests never overwrite each other. */
  update(
    nodeId: NodeId,
    code: string,
    change: (notes: StoredNotes) => StoredNotes,
  ): Promise<StoredNotes>;
}

const itemSchema = z.object({
  id: z.string(),
  command: z.string(),
  reason: z.string(),
  line: z.number().int(),
  severity: z.enum(["alta", "media", "baixa"]),
});

const fileSchema = z.object({
  schemaVersion: z.literal(1),
  nodeId: z.string(),
  codeHash: z.string(),
  saved: z.array(itemSchema),
  dismissed: z.array(z.string()),
});

const EMPTY: StoredNotes = { saved: [], dismissed: [] };

const hashOf = (code: string) =>
  createHash("sha256").update(normalizeCode(code)).digest("hex");

/** One JSON file per node in `<dir>/notes` (`notes-en` in English); atomic write. A file that is missing, broken or of another code counts as empty. */
export function createNotesStore(
  dir: string,
  locale: Locale = DEFAULT_LOCALE,
): NotesStore {
  const folder = join(dir, folderOf("notes", locale));
  const fileOf = (nodeId: NodeId) =>
    join(folder, `${createHash("sha256").update(nodeId).digest("hex")}.json`);
  let turn: Promise<unknown> = Promise.resolve();

  async function read(nodeId: NodeId, code: string): Promise<StoredNotes> {
    try {
      const parsed = fileSchema.safeParse(
        JSON.parse(await readFile(fileOf(nodeId), "utf8")),
      );
      if (!parsed.success || parsed.data.codeHash !== hashOf(code)) {
        return EMPTY;
      }
      return { saved: parsed.data.saved, dismissed: parsed.data.dismissed };
    } catch {
      return EMPTY;
    }
  }

  return {
    get: (nodeId, code) => read(nodeId, code),
    update(nodeId, code, change) {
      const run = turn.then(async () => {
        const next = change(await read(nodeId, code));
        await mkdir(folder, { recursive: true });
        const tmp = join(folder, `${randomUUID()}.tmp`);
        await writeFile(
          tmp,
          JSON.stringify({
            schemaVersion: 1,
            nodeId,
            codeHash: hashOf(code),
            ...next,
          }),
          "utf8",
        );
        await rename(tmp, fileOf(nodeId));
        return next;
      });
      turn = run.catch(() => undefined);
      return run;
    },
  };
}

/** Keeps a suggestion (`line` already relative). The same text twice is kept once; keeping it again undoes its removal. */
export function withSaved(
  notes: StoredNotes,
  item: Omit<SavedItem, "id">,
): StoredNotes {
  const key = suggestionKey(item);
  const dismissed = notes.dismissed.filter((k) => k !== key);
  if (notes.saved.some((s) => suggestionKey(s) === key)) {
    return { ...notes, dismissed };
  }
  const next =
    Math.max(
      0,
      ...notes.saved.map((s) => Number(s.id.replace("chat-", "")) || 0),
    ) + 1;
  return {
    saved: [...notes.saved, { id: `chat-${next}`, ...item }],
    dismissed,
  };
}

export function withoutSaved(notes: StoredNotes, id: string): StoredNotes {
  return { ...notes, saved: notes.saved.filter((s) => s.id !== id) };
}

/** Removes a generated suggestion from the node: its key is remembered, so a new request never brings it back. */
export function withDismissed(notes: StoredNotes, key: string): StoredNotes {
  return notes.dismissed.includes(key)
    ? notes
    : { ...notes, dismissed: [...notes.dismissed, key] };
}
