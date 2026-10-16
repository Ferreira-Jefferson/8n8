import { pythonPlugin } from "@8n8/lang-python";
import type { ClaudeLocation } from "@8n8/llm";
import type { StoredSettings } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { PickPath } from "../pick-path";
import { createSettingsService, type SettingsStore } from "../settings";
import { TEST_TOKEN } from "./test-token";

const PICKED = "D:\\tools\\claude.exe";

/** The app with the real settings service, a fake disk and a chooser that answers `chosen`. */
function setup(
  chosen: string | null | Error,
  files: string[] = [PICKED],
  initial: StoredSettings = {},
) {
  let stored = { ...initial };
  const writes: StoredSettings[] = [];
  const store: SettingsStore = {
    read: async () => ({ ...stored }),
    write: async (s) => {
      writes.push(s);
      stored = { ...s };
    },
  };
  const locate = (_env: unknown, picked?: string): ClaudeLocation =>
    picked && files.includes(picked)
      ? { path: picked, source: "picked", envInvalid: false }
      : { path: undefined, source: undefined, envInvalid: false };
  const asked: Parameters<PickPath>[] = [];
  const pick: PickPath = async (...args) => {
    asked.push(args);
    if (chosen instanceof Error) throw chosen;
    return chosen;
  };
  const app = createApp({
    plugins: [pythonPlugin],
    explain: async () => ({ status: "no-key" }),
    titles: async () => ({ status: "ok", titles: [] }),
    readProject: async () => ({ kind: "not-found" }),
    port: 8148,
    token: TEST_TOKEN,
    settings: createSettingsService({}, store, undefined, locate),
    pick,
  });
  const post = (body: string) =>
    app.request("/api/settings/claude-path", {
      method: "POST",
      headers: {
        host: "127.0.0.1:8148",
        "x-8n8-token": TEST_TOKEN,
        "content-type": "application/json",
      },
      body,
    });
  return { post, writes, asked };
}

describe("POST /api/settings/claude-path (CC-18)", () => {
  it("opens the system's file chooser and stores the claude it gives", async () => {
    const { post, writes, asked } = setup(PICKED);
    const res = await post(JSON.stringify({ action: "pick" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      provider: "claude-code",
      claude: { path: PICKED, source: "picked" },
    });
    expect(writes).toEqual([{ claudePath: PICKED }]);
    expect(asked).toEqual([["file", [".exe"], "Claude Code", "pt-BR"]]);
  });

  it("changes nothing when the person closes the chooser", async () => {
    const { post, writes } = setup(null);
    const res = await post(JSON.stringify({ action: "pick" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ claude: { path: null } });
    expect(writes).toEqual([]);
  });

  it("answers 400 not-claude to a file with another name, or one that is gone", async () => {
    for (const chosen of ["D:\\tools\\calc.exe", "D:\\gone\\claude.exe"]) {
      const { post, writes } = setup(chosen, ["D:\\tools\\calc.exe"]);
      const res = await post(JSON.stringify({ action: "pick" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "not-claude" });
      expect(writes).toEqual([]);
    }
  });

  it("answers 500 pick-failed when the chooser does not open", async () => {
    const { post } = setup(new Error("no display"));
    const res = await post(JSON.stringify({ action: "pick" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "pick-failed" });
  });

  it("erases the picked file with auto, without opening the chooser", async () => {
    const { post, writes, asked } = setup(PICKED, [PICKED], {
      claudePath: PICKED,
    });
    const res = await post(JSON.stringify({ action: "auto" }));
    expect(res.status).toBe(200);
    expect(writes).toEqual([{}]);
    expect(asked).toEqual([]);
  });

  it.each([
    ["a path in the body", JSON.stringify({ action: "pick", path: PICKED })],
    ["a path alone", JSON.stringify({ path: PICKED })],
    ["an unknown action", JSON.stringify({ action: "set" })],
    ["a body that is not JSON", "{ quebrado"],
  ])(
    "answers 400 to %s and never takes a path from the request (CC-12)",
    async (_, body) => {
      const { post, writes, asked } = setup(PICKED);
      expect((await post(body)).status).toBe(400);
      expect(writes).toEqual([]);
      expect(asked).toEqual([]);
    },
  );
});
