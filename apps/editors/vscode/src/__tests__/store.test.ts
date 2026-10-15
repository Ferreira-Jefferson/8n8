import { describe, expect, it } from "vitest";
import {
  createVscodeSettingsStore,
  type MementoLike,
  SECRET_KEY,
  type SecretsLike,
  STATE_KEY,
} from "../store";

const KEY = "sk-vscode-sentinel-0000000000000000000000";

/** VS Code's SecretStorage and globalState, in memory. */
function editor(initialState: unknown = undefined, initialSecret?: string) {
  const secrets = new Map<string, string>();
  if (initialSecret) secrets.set(SECRET_KEY, initialSecret);
  const state = new Map<string, unknown>();
  if (initialState !== undefined) state.set(STATE_KEY, initialState);
  const secretStorage: SecretsLike = {
    get: async (k) => secrets.get(k),
    store: async (k, v) => void secrets.set(k, v),
    delete: async (k) => void secrets.delete(k),
  };
  const memento: MementoLike = {
    get: <T>(k: string) => state.get(k) as T | undefined,
    update: async (k, v) => void state.set(k, v),
  };
  return {
    store: createVscodeSettingsStore(secretStorage, memento),
    secrets,
    state,
  };
}

describe("createVscodeSettingsStore (VSC-05)", () => {
  it("reads empty settings from a new editor", async () => {
    expect(await editor().store.read()).toEqual({});
  });

  it("keeps the key in SecretStorage only, never in globalState", async () => {
    const e = editor();
    await e.store.write({ apiKey: KEY, model: "m/x", autoSummary: true });
    expect(e.secrets.get(SECRET_KEY)).toBe(KEY);
    expect(e.state.get(STATE_KEY)).toEqual({ model: "m/x", autoSummary: true });
    expect(JSON.stringify([...e.state.values()])).not.toContain(KEY);
    expect(await e.store.read()).toEqual({
      apiKey: KEY,
      model: "m/x",
      autoSummary: true,
    });
  });

  it("deletes the secret when the settings have no key", async () => {
    const e = editor({ model: "m/x" }, KEY);
    await e.store.write({ model: "m/y" });
    expect(e.secrets.has(SECRET_KEY)).toBe(false);
    expect(await e.store.read()).toEqual({ model: "m/y" });
  });

  it("drops unknown fields and fields of the wrong type from globalState", async () => {
    const e = editor({
      provider: "openrouter",
      model: 42,
      autoSuggestions: "sim",
      apiKey: "não deveria estar aqui",
      extra: true,
    });
    expect(await e.store.read()).toEqual({ provider: "openrouter" });
  });

  it("keeps a valid theme and drops an unknown one", async () => {
    expect(await editor({ theme: "dark" }).store.read()).toEqual({
      theme: "dark",
    });
    expect(await editor({ theme: "neon" }).store.read()).toEqual({});
  });

  it("reads a globalState that is not an object as empty", async () => {
    expect(await editor("texto").store.read()).toEqual({});
    expect(await editor(null).store.read()).toEqual({});
  });
});
