import { pythonPlugin } from "@8n8/lang-python";
import type { StoredSettings } from "@8n8/model";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { createSettingsService, type SettingsStore } from "../settings";
import { NO_CLAUDE } from "./llm-of";
import { TEST_TOKEN } from "./test-token";

const KEY = "sk-route-sentinel-000000000000000000000";

/** The app with the real settings service over a store that records its writes. */
function setup(store?: SettingsStore) {
  const writes: StoredSettings[] = [];
  const memory: SettingsStore = store ?? {
    read: async () => ({}),
    write: async (s) => {
      writes.push(s);
    },
  };
  const app = createApp({
    plugins: [pythonPlugin],
    explain: async () => ({ status: "no-key" }),
    titles: async () => ({ status: "ok", titles: [] }),
    readProject: async () => ({ kind: "not-found" }),
    port: 8148,
    token: TEST_TOKEN,
    settings: createSettingsService({}, memory, undefined, NO_CLAUDE),
  });
  const headers = {
    host: "127.0.0.1:8148",
    "x-8n8-token": TEST_TOKEN,
    "content-type": "application/json",
  };
  const put = (body: string) =>
    app.request("/api/settings", { method: "PUT", headers, body });
  const get = () => app.request("/api/settings", { headers });
  return { writes, put, get };
}

describe("PUT /api/settings (CFG-13, CFG-14)", () => {
  it("stores a valid patch and answers 200 with the view, without the key", async () => {
    const { writes, put } = setup();
    const res = await put(JSON.stringify({ apiKey: KEY, autoSummary: true }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ hasKey: true, autoSummary: true });
    expect(text).not.toContain(KEY.slice(0, 6));
    expect(writes).toEqual([{ apiKey: KEY, autoSummary: true }]);
  });

  it.each([
    ["an unknown field", JSON.stringify({ apiKey: KEY, extra: 1 })],
    ["a base URL", JSON.stringify({ baseURL: "http://127.0.0.1/v1" })],
    ["an empty key", JSON.stringify({ apiKey: "" })],
    ["an unknown provider", JSON.stringify({ provider: "nope" })],
    ["a body that is not JSON", "{ quebrado"],
  ])(
    "answers 400 invalid settings to %s and stores nothing",
    async (_, body) => {
      const { writes, put } = setup();
      const res = await put(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid settings" });
      expect(writes).toEqual([]);
    },
  );

  it("answers 500 save failed when the store fails, with no key in the body", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { put } = setup({
      read: async () => ({}),
      write: async () => {
        throw new Error(`EPERM rename ${KEY}`);
      },
    });
    const res = await put(JSON.stringify({ apiKey: KEY }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "save failed" });
    expect(text).not.toContain(KEY.slice(0, 6));
    // The log line keeps the error, never the key either.
    expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY);
    spy.mockRestore();
  });
});

describe("GET /api/settings (CFG-12)", () => {
  it("answers the view, and 404 when the app has no settings", async () => {
    const { get } = setup();
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ provider: "openrouter" });

    const bare = createApp({
      plugins: [pythonPlugin],
      explain: async () => ({ status: "no-key" }),
      titles: async () => ({ status: "ok", titles: [] }),
      readProject: async () => ({ kind: "not-found" }),
      port: 8148,
      token: TEST_TOKEN,
    });
    const none = await bare.request("/api/settings", {
      headers: { host: "127.0.0.1:8148", "x-8n8-token": TEST_TOKEN },
    });
    expect(none.status).toBe(404);
  });
});
