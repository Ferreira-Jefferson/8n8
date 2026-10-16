import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { suggestionKey } from "@8n8/model";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createNotesStore,
  withDismissed,
  withoutSaved,
  withSaved,
} from "../notes";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "8n8-notes-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const item = {
  command: "Defina um timeout.",
  reason: "A chamada pode travar.",
  line: 2,
  severity: "media" as const,
};
const none = { saved: [], dismissed: [] };

describe("suggestionKey", () => {
  it("is the text, trimmed and lowercase", () => {
    expect(suggestionKey({ command: " Fazer ", reason: "Porque" })).toBe(
      suggestionKey({ command: "fazer", reason: " porque " }),
    );
  });
});

describe("the notes of a node, in memory", () => {
  it("keeps a suggestion once, with a growing id", () => {
    const one = withSaved(none, item);
    expect(one.saved.map((s) => s.id)).toEqual(["chat-1"]);
    expect(withSaved(one, item)).toEqual(one);
    const two = withSaved(one, { ...item, command: "Outra coisa." });
    expect(two.saved.map((s) => s.id)).toEqual(["chat-1", "chat-2"]);
    const gone = withoutSaved(two, "chat-1");
    expect(
      withSaved(gone, { ...item, command: "Mais uma." }).saved[1]?.id,
    ).toBe("chat-3");
  });

  it("remembers a removed generated suggestion once, and keeping it again undoes the removal", () => {
    const key = suggestionKey(item);
    const dismissed = withDismissed(withDismissed(none, key), key);
    expect(dismissed.dismissed).toEqual([key]);
    expect(withSaved(dismissed, item).dismissed).toEqual([]);
  });

  it("removes only the suggestion asked for", () => {
    const both = withSaved(withSaved(none, item), { ...item, command: "B" });
    expect(withoutSaved(both, "chat-1").saved.map((s) => s.id)).toEqual([
      "chat-2",
    ]);
    expect(withoutSaved(both, "nao-existe")).toEqual(both);
  });
});

describe("createNotesStore", () => {
  const code = "def f():\n    return 1\n";

  it("starts empty and gives back what an update wrote", async () => {
    const store = createNotesStore(dir);
    expect(await store.get("n1", code)).toEqual(none);
    await store.update("n1", code, (n) => withSaved(n, item));
    const again = createNotesStore(dir);
    expect((await again.get("n1", code)).saved).toHaveLength(1);
    expect((await again.get("n2", code)).saved).toHaveLength(0);
  });

  it("forgets everything when the code of the node changed", async () => {
    const store = createNotesStore(dir);
    await store.update("n1", code, (n) => withSaved(n, item));
    expect(await store.get("n1", "def f():\n    return 2\n")).toEqual(none);
  });

  it("ignores a change that is only line endings or trailing spaces", async () => {
    const store = createNotesStore(dir);
    await store.update("n1", code, (n) => withSaved(n, item));
    expect(
      (await store.get("n1", "def f():   \r\n    return 1\r\n")).saved,
    ).toHaveLength(1);
  });

  it("keeps each language of the system in its own folder", async () => {
    await createNotesStore(dir, "pt-BR").update("n1", code, (n) =>
      withSaved(n, item),
    );
    expect(await createNotesStore(dir, "en").get("n1", code)).toEqual(none);
    expect(readdirSync(dir).sort()).toEqual(["notes"]);
    await createNotesStore(dir, "en").update("n1", code, (n) =>
      withSaved(n, item),
    );
    expect(readdirSync(dir).sort()).toEqual(["notes", "notes-en"]);
  });

  it("never loses a change when two requests come together", async () => {
    const store = createNotesStore(dir);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        store.update("n1", code, (n) =>
          withSaved(n, { ...item, command: `Ação ${i}` }),
        ),
      ),
    );
    expect((await store.get("n1", code)).saved).toHaveLength(8);
  });

  it("counts a broken file as empty and replaces it on the next change", async () => {
    const store = createNotesStore(dir);
    await store.update("n1", code, (n) => withSaved(n, item));
    const folder = join(dir, "notes");
    const [file] = readdirSync(folder);
    writeFileSync(join(folder, file as string), "{ não é json");
    expect(await store.get("n1", code)).toEqual(none);
    await store.update("n1", code, (n) => withSaved(n, item));
    expect((await store.get("n1", code)).saved).toHaveLength(1);
  });
});
