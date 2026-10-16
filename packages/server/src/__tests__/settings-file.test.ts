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
import { createFileSettingsStore, type FileOps } from "../settings-file";

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

  it("keeps the picked Claude Code path between runs (CC-18)", async () => {
    const path = join(dir, "config.json");
    const store = createFileSettingsStore(path);
    await store.write({ claudePath: "D:\\tools\\claude.exe" });
    expect(await createFileSettingsStore(path).read()).toEqual({
      claudePath: "D:\\tools\\claude.exe",
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

describe("the write is atomic and survives a busy file (CFG-19, CFG-25)", () => {
  /** The real file operations, with a log and an injected failure. */
  function opsWith(fail: Partial<Record<keyof FileOps, () => never>> = {}) {
    const log: string[] = [];
    const ops: FileOps = {
      readFile: (p, e) => readFile(p, e),
      writeFile: async (p, data, options) => {
        log.push(`write ${p} ${options.mode.toString(8)}`);
        fail.writeFile?.();
        writeFileSync(p, data, options);
      },
      rename: async (from, to) => {
        log.push(`rename ${from} -> ${to}`);
        fail.rename?.();
        const { renameSync } = await import("node:fs");
        renameSync(from, to);
      },
      rm: async (p, options) => {
        log.push(`rm ${p}`);
        rmSync(p, options);
      },
      mkdir: async (p, options) => {
        const { mkdirSync } = await import("node:fs");
        mkdirSync(p, options);
      },
    };
    return { ops, log };
  }

  it("writes a temporary file with mode 600 and renames it over config.json", async () => {
    const path = join(dir, "config.json");
    const { ops, log } = opsWith();
    await createFileSettingsStore(path, ops).write({ apiKey: KEY });
    expect(log).toHaveLength(2);
    expect(log[0]).toMatch(/^write .*config\.json\.[0-9a-f-]+\.tmp 600$/);
    const tmp = (log[0] as string).split(" ")[1];
    expect(log[1]).toBe(`rename ${tmp} -> ${path}`);
  });

  it("keeps the old file whole and leaves no temporary file when the write fails midway", async () => {
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ model: "m/velho" }));
    const { ops } = opsWith({
      writeFile: () => {
        throw new Error("disco cheio");
      },
    });
    await expect(
      createFileSettingsStore(path, ops).write({ model: "m/novo" }),
    ).rejects.toThrow("disco cheio");
    expect(await createFileSettingsStore(path).read()).toEqual({
      model: "m/velho",
    });
    expect(readdirSync(dir)).toEqual(["config.json"]);
  });

  it("tries the rename again while Windows holds the file (EPERM, EACCES, EBUSY)", async () => {
    const path = join(dir, "config.json");
    writeFileSync(path, "{}");
    let failures = 0;
    const codes = ["EPERM", "EBUSY", "EACCES"];
    const { ops, log } = opsWith({
      rename: () => {
        const code = codes[failures];
        if (code === undefined) return undefined as never;
        failures++;
        throw Object.assign(new Error(code), { code });
      },
    });
    await createFileSettingsStore(path, ops).write({ apiKey: KEY });
    expect(log.filter((l) => l.startsWith("rename"))).toHaveLength(4);
    expect(await createFileSettingsStore(path).read()).toEqual({ apiKey: KEY });
    expect(readdirSync(dir)).toEqual(["config.json"]);
  });

  it("gives up after the retries, removes the temporary file and keeps the old one", async () => {
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ model: "m/velho" }));
    const { ops, log } = opsWith({
      rename: () => {
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      },
    });
    await expect(
      createFileSettingsStore(path, ops).write({ model: "m/novo" }),
    ).rejects.toThrow("EPERM");
    expect(log.filter((l) => l.startsWith("rename"))).toHaveLength(10);
    expect(readdirSync(dir)).toEqual(["config.json"]);
    expect(await createFileSettingsStore(path).read()).toEqual({
      model: "m/velho",
    });
  });

  it("never retries an error that is not a busy file", async () => {
    const path = join(dir, "config.json");
    const { ops, log } = opsWith({
      rename: () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    });
    await expect(createFileSettingsStore(path, ops).write({})).rejects.toThrow(
      "ENOENT",
    );
    expect(log.filter((l) => l.startsWith("rename"))).toHaveLength(1);
  });
});
