import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileSettingsStore } from "../settings-file";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "8n8-settings-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const KEY = "sk-test-not-a-real-key-0000";

describe("createFileSettingsStore (CFG-19)", () => {
  it("reads a missing file as empty settings", async () => {
    expect(
      await createFileSettingsStore(join(dir, "config.json")).read(),
    ).toEqual({});
  });

  it.each([
    ["not JSON", "{ quebrado"],
    ["JSON of another shape", JSON.stringify({ apiKey: 42 })],
    ["a JSON array", "[]"],
  ])("reads %s as empty settings", async (_, text) => {
    const path = join(dir, "config.json");
    writeFileSync(path, text);
    expect(await createFileSettingsStore(path).read()).toEqual({});
  });

  it("drops unknown fields on read", async () => {
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ model: "m/x", extra: true }));
    expect(await createFileSettingsStore(path).read()).toEqual({
      model: "m/x",
    });
  });

  it("writes and reads back, creating the folder, and leaves no temporary file", async () => {
    const path = join(dir, "nested", ".8n8", "config.json");
    const store = createFileSettingsStore(path);
    await store.write({ apiKey: KEY, autoSummary: true });
    expect(await store.read()).toEqual({ apiKey: KEY, autoSummary: true });
    expect(readdirSync(join(dir, "nested", ".8n8"))).toEqual(["config.json"]);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      apiKey: KEY,
      autoSummary: true,
    });
  });

  it("replaces the whole file on each write", async () => {
    const path = join(dir, "config.json");
    const store = createFileSettingsStore(path);
    await store.write({ apiKey: KEY, model: "m/x" });
    await store.write({ model: "m/y" });
    expect(await store.read()).toEqual({ model: "m/y" });
  });

  it.skipIf(process.platform === "win32")(
    "gives the file owner-only permission, even over a wider file (CFG-19, CFG-25)",
    async () => {
      const path = join(dir, "config.json");
      writeFileSync(path, "{}", { mode: 0o644 });
      await createFileSettingsStore(path).write({ apiKey: KEY });
      expect(statSync(path).mode & 0o777).toBe(0o600);
    },
  );
});
