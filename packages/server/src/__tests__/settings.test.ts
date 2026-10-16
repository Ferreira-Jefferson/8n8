import { type ClaudeLocation, type LlmConfig, PROVIDERS } from "@8n8/llm";
import type { LlmClient, StoredSettings } from "@8n8/model";
import { describe, expect, it } from "vitest";
import {
  applyPatch,
  createSettingsService,
  InvalidSettings,
  type SettingsStore,
} from "../settings";
import { NO_CLAUDE } from "./llm-of";

/** The service on a machine with no Claude Code, unless a test passes its own lookup. */
const settingsService = (
  env: Parameters<typeof createSettingsService>[0],
  store: SettingsStore,
  createClient?: Parameters<typeof createSettingsService>[2],
  locate: Parameters<typeof createSettingsService>[3] = NO_CLAUDE,
) => createSettingsService(env, store, createClient, locate);

/** A store in memory that records every write. */
function memoryStore(initial: StoredSettings = {}) {
  let current = { ...initial };
  const writes: StoredSettings[] = [];
  const store: SettingsStore = {
    read: async () => ({ ...current }),
    write: async (s) => {
      writes.push(s);
      current = { ...s };
    },
  };
  return { store, writes, current: () => current };
}

/** A client factory that records the configs it gets. */
function factory() {
  const configs: LlmConfig[] = [];
  const createClient = (config: LlmConfig): LlmClient | undefined => {
    configs.push(config);
    return config.apiKey === undefined
      ? undefined
      : { complete: async () => "{}" };
  };
  return { configs, createClient };
}

const KEY = "sk-test-not-a-real-key-0000";
const DEFAULT_MODEL = "~deepseek/deepseek-v4-flash-latest";

describe("view (CFG-12)", () => {
  it("shows the defaults, the providers and no key with nothing set", async () => {
    const view = await settingsService({}, memoryStore().store).view();
    expect(view).toEqual({
      provider: "openrouter",
      model: DEFAULT_MODEL,
      autoSummary: false,
      autoSuggestions: false,
      theme: "system",
      locale: "pt-BR",
      hasKey: false,
      providers: PROVIDERS.map(({ id, defaultModel, usesKey }) => ({
        id,
        defaultModel,
        usesKey,
      })),
      env: {},
      claude: { path: null, source: null, envInvalid: false },
    });
    expect(view.providers.map((p) => p.id)).toEqual([
      "openrouter",
      "openai",
      "anthropic",
      "openai-compatible",
      "claude-code",
    ]);
  });

  it("shows the stored settings, says a key exists and never shows it", async () => {
    const { store } = memoryStore({
      apiKey: KEY,
      model: "m/x",
      autoSummary: true,
    });
    const view = await settingsService({}, store).view();
    expect(view).toMatchObject({
      provider: "openrouter",
      model: "m/x",
      autoSummary: true,
      autoSuggestions: false,
      hasKey: true,
    });
    expect(JSON.stringify(view)).not.toContain(KEY);
    expect(JSON.stringify(view)).not.toContain(KEY.slice(0, 6));
  });

  it("names the variable of each field the environment sets, and only those (CFG-22)", async () => {
    const env = {
      OPENROUTER_API_KEY: KEY,
      APP8N8_MODEL: "env/model",
      APP8N8_AUTO_SUMMARY: "1",
      APP8N8_AUTO_SUGGESTIONS: "talvez",
      APP8N8_LLM_BASE_URL: "http://other-provider",
    };
    const view = await settingsService(env, memoryStore().store).view();
    expect(view.env).toEqual({
      apiKey: "OPENROUTER_API_KEY",
      model: "APP8N8_MODEL",
      autoSummary: "APP8N8_AUTO_SUMMARY",
    });
    expect(view).toMatchObject({
      model: "env/model",
      autoSummary: true,
      autoSuggestions: false,
      hasKey: true,
    });
    expect(JSON.stringify(view)).not.toContain(KEY);
  });

  it("stores the theme, and rejects one that does not exist", async () => {
    const mem = memoryStore();
    const service = settingsService({}, mem.store);
    expect(await service.update({ theme: "light" })).toMatchObject({
      theme: "light",
    });
    expect(mem.current()).toEqual({ theme: "light" });
    await expect(service.update({ theme: "neon" })).rejects.toThrow();
    expect(mem.current()).toEqual({ theme: "light" });
  });

  it("lets the environment flags win over the stored modes: 1/true and 0/false", async () => {
    const { store } = memoryStore({
      autoSummary: true,
      autoSuggestions: false,
    });
    const service = settingsService(
      { APP8N8_AUTO_SUMMARY: "false", APP8N8_AUTO_SUGGESTIONS: "TRUE" },
      store,
    );
    expect(await service.auto()).toEqual({ summary: false, suggestions: true });
  });

  it("reads a store that fails as empty settings", async () => {
    const failing: SettingsStore = {
      read: async () => {
        throw new Error("disco");
      },
      write: async () => {},
    };
    expect(await settingsService({}, failing).view()).toMatchObject({
      hasKey: false,
      provider: "openrouter",
    });
  });
});

describe("update (CFG-13, CFG-14)", () => {
  it("stores the fields of the patch and answers the new view", async () => {
    const mem = memoryStore();
    const service = settingsService({}, mem.store);
    const view = await service.update({
      apiKey: KEY,
      model: "m/x",
      autoSuggestions: true,
    });
    expect(mem.current()).toEqual({
      apiKey: KEY,
      model: "m/x",
      autoSuggestions: true,
    });
    expect(view).toMatchObject({
      hasKey: true,
      model: "m/x",
      autoSuggestions: true,
    });
    expect(JSON.stringify(view)).not.toContain(KEY);
  });

  it("erases apiKey and model with null", async () => {
    const mem = memoryStore({
      apiKey: KEY,
      model: "m/x",
      autoSummary: true,
    });
    await settingsService({}, mem.store).update({
      apiKey: null,
      model: null,
    });
    expect(mem.current()).toEqual({ autoSummary: true });
  });

  it.each([
    ["an unknown field", { apiKey: KEY, extra: 1 }],
    ["an unknown provider", { provider: "nope" }],
    ["a base URL, which only the environment sets", { baseURL: "http://x/v1" }],
    ["an empty key", { apiKey: "" }],
    ["a blank key", { apiKey: "   " }],
    ["a mode that is not a boolean", { autoSummary: "sim" }],
    [
      "a model that reads as a flag",
      { model: "--dangerously-skip-permissions" },
    ],
    ["a model with a space", { model: "sonnet --bare" }],
    ["a body that is not an object", "texto"],
    ["no body", null],
  ])("refuses %s and stores nothing", async (_, patch) => {
    const mem = memoryStore({ apiKey: KEY });
    const service = settingsService({}, mem.store);
    await expect(service.update(patch)).rejects.toBeInstanceOf(InvalidSettings);
    expect(mem.writes).toEqual([]);
    expect((await service.view()).hasKey).toBe(true);
  });

  it("runs writes one at a time, in order", async () => {
    const mem = memoryStore();
    const service = settingsService({}, mem.store);
    await Promise.all([
      service.update({ model: "a/1" }),
      service.update({ autoSummary: true }),
    ]);
    expect(mem.current()).toEqual({ model: "a/1", autoSummary: true });
  });
});

describe("model ids the patch accepts", () => {
  it.each([
    "sonnet",
    "claude-sonnet-4-6",
    "~deepseek/deepseek-v4-flash-latest",
    "openai/gpt-4o-mini",
    "llama3.1:8b",
    "sonnet[1m]",
    "dots-studio/dots-3-note-preview:free",
    "gpt-4.1-nano",
    "claude-haiku-5-5",
  ])("accepts %s", async (model) => {
    const mem = memoryStore();
    await settingsService({}, mem.store).update({ model });
    expect(mem.current().model).toBe(model);
  });
});

describe("applyPatch: the key never follows a new destination (CFG-15)", () => {
  const stored = { apiKey: KEY, model: "m/x" };

  it("erases the key and the model when the provider changes", () => {
    expect(applyPatch(stored, { provider: "anthropic" })).toEqual({
      provider: "anthropic",
    });
  });

  it("keeps a new key and model brought by the same patch", () => {
    expect(
      applyPatch(stored, {
        provider: "anthropic",
        apiKey: "new-key",
        model: "claude-haiku-5-5",
      }),
    ).toEqual({
      provider: "anthropic",
      apiKey: "new-key",
      model: "claude-haiku-5-5",
    });
  });

  it("keeps the key when the provider stays the same", () => {
    expect(
      applyPatch(stored, { provider: "openrouter", autoSummary: true }),
    ).toEqual({ ...stored, provider: "openrouter", autoSummary: true });
  });
});

describe("llm (CFG-16, CFG-17)", () => {
  it("builds no client without a key, and one with the stored key", async () => {
    const f = factory();
    const mem = memoryStore();
    const service = settingsService({}, mem.store, f.createClient);
    expect((await service.llm()).client).toBeUndefined();
    await service.update({ apiKey: KEY });
    const { client, config } = await service.llm();
    expect(client).toBeDefined();
    expect(config).toMatchObject({ provider: "openrouter", apiKey: KEY });
  });

  it("builds a new client only when the settings change", async () => {
    const f = factory();
    const service = settingsService(
      { OPENROUTER_API_KEY: KEY },
      memoryStore().store,
      f.createClient,
    );
    const a = await service.llm();
    const b = await service.llm();
    expect(b).toBe(a);
    expect(f.configs).toHaveLength(1);
    await service.update({ autoSummary: true });
    expect(await service.llm()).toBe(a);
    await service.update({ model: "m/novo" });
    const c = await service.llm();
    expect(c).not.toBe(a);
    expect(c.config.model).toBe("m/novo");
    expect(f.configs).toHaveLength(2);
  });

  it("lets the environment key win over the stored one", async () => {
    const f = factory();
    const service = settingsService(
      { OPENROUTER_API_KEY: "env-key-0000000" },
      memoryStore({ apiKey: KEY }).store,
      f.createClient,
    );
    expect((await service.llm()).config.apiKey).toBe("env-key-0000000");
  });

  it("cuts the key from a provider error, whole and by its start (DIST-17)", async () => {
    const service = settingsService(
      {},
      memoryStore({ apiKey: KEY }).store,
      () => ({
        complete: async () => {
          throw new Error(`bad key ${KEY} and ${KEY.slice(0, 8)}***`);
        },
      }),
    );
    const { client } = await service.llm();
    const error = await client
      ?.complete({ model: "m", messages: [], json: "native" })
      .catch((e: Error) => e.message);
    expect(error).toBe("bad key [***] and [***]");
  });
});

describe("the claude-code provider through the settings (CC-01, CC-02, CC-12)", () => {
  // Any file that exists stands for the executable: the client is never called here.
  const exe = process.execPath;

  it("builds no client when the executable is missing: the pipeline answers no-key", async () => {
    const service = settingsService(
      { APP8N8_CLAUDE_PATH: `${exe}.nada` },
      memoryStore({ provider: "claude-code" }).store,
    );
    expect((await service.llm()).client).toBeUndefined();
  });

  it("builds a client with the executable named by the host environment", async () => {
    const service = settingsService(
      { APP8N8_CLAUDE_PATH: exe },
      memoryStore({ provider: "claude-code" }).store,
    );
    const { client, config } = await service.llm();
    expect(client).toBeDefined();
    expect(config).toMatchObject({
      provider: "claude-code",
      model: "claude-sonnet-5-5",
    });
  });

  it("shows no key and no key variable for claude-code", async () => {
    const view = await settingsService(
      { APP8N8_CLAUDE_PATH: exe, OPENROUTER_API_KEY: KEY },
      memoryStore({ provider: "claude-code" }).store,
    ).view();
    expect(view).toMatchObject({ provider: "claude-code", hasKey: false });
    expect(view.env).toEqual({});
  });

  it("refuses a path to the executable through a patch", async () => {
    const mem = memoryStore();
    const service = settingsService({}, mem.store);
    for (const field of ["claudePath", "executable", "APP8N8_CLAUDE_PATH"]) {
      await expect(
        service.update({ provider: "claude-code", [field]: "C:/x.exe" }),
      ).rejects.toBeInstanceOf(InvalidSettings);
    }
    expect(mem.writes).toEqual([]);
  });
});

describe("Claude Code on this machine (CC-15, CC-17, CC-18)", () => {
  const AUTO = "C:\\npm\\claude.exe";
  const PICKED = "D:\\tools\\claude.exe";
  /** A lookup over a fake disk: the picked file counts when it exists, then the install place. */
  const disk =
    (files: string[], auto?: string) =>
    (_env: unknown, picked?: string): ClaudeLocation =>
      picked && files.includes(picked)
        ? { path: picked, source: "picked", envInvalid: false }
        : auto
          ? { path: auto, source: "auto", envInvalid: false }
          : { path: undefined, source: undefined, envInvalid: false };

  it("uses claude-code by default when Claude Code is found, and openrouter when not", async () => {
    const found = createSettingsService(
      {},
      memoryStore().store,
      undefined,
      disk([], AUTO),
    );
    expect(await found.view()).toMatchObject({
      provider: "claude-code",
      model: "claude-sonnet-5-5",
      claude: { path: AUTO, source: "auto", envInvalid: false },
    });
    const missing = createSettingsService(
      {},
      memoryStore().store,
      undefined,
      disk([]),
    );
    expect(await missing.view()).toMatchObject({
      provider: "openrouter",
      claude: { path: null, source: null },
    });
  });

  it("lets a provider from the environment or the store win over the automatic default", async () => {
    const env = { APP8N8_LLM_PROVIDER: "openai" };
    expect(
      (
        await createSettingsService(
          env,
          memoryStore().store,
          undefined,
          disk([], AUTO),
        ).view()
      ).provider,
    ).toBe("openai");
    const stored = memoryStore({ provider: "anthropic" }).store;
    expect(
      (
        await createSettingsService(
          {},
          stored,
          undefined,
          disk([], AUTO),
        ).view()
      ).provider,
    ).toBe("anthropic");
  });

  it("reads a key or model stored with no provider as openrouter's, as before the automatic default", async () => {
    const legacy = memoryStore({ apiKey: KEY }).store;
    expect(
      await createSettingsService({}, legacy, undefined, disk([], AUTO)).view(),
    ).toMatchObject({ provider: "openrouter", hasKey: true });
  });

  it("pins claude-code when a model is saved under the automatic default", async () => {
    const mem = memoryStore();
    const service = createSettingsService(
      {},
      mem.store,
      undefined,
      disk([], AUTO),
    );
    expect(await service.update({ model: "claude-haiku-5-5" })).toMatchObject({
      provider: "claude-code",
      model: "claude-haiku-5-5",
    });
    expect(mem.current()).toEqual({
      provider: "claude-code",
      model: "claude-haiku-5-5",
    });
  });

  it("stores a picked file named claude that exists, and the client config carries it", async () => {
    const mem = memoryStore();
    const f = factory();
    const service = createSettingsService(
      {},
      mem.store,
      f.createClient,
      disk([PICKED]),
    );
    expect(await service.setClaudePath(PICKED)).toMatchObject({
      provider: "claude-code",
      claude: { path: PICKED, source: "picked" },
    });
    expect(mem.current()).toEqual({ claudePath: PICKED });
    await service.llm();
    expect(f.configs.at(-1)?.claudePath).toBe(PICKED);
  });

  it("refuses a file with another name or one that does not exist, and stores nothing", async () => {
    const mem = memoryStore();
    const other = "D:\\tools\\calc.exe";
    const service = createSettingsService(
      {},
      mem.store,
      undefined,
      disk([other]),
    );
    await expect(service.setClaudePath(other)).rejects.toThrow(InvalidSettings);
    await expect(service.setClaudePath(PICKED)).rejects.toThrow(
      InvalidSettings,
    );
    expect(mem.writes).toEqual([]);
  });

  it("erases the picked file with null, back to the automatic lookup", async () => {
    const mem = memoryStore({ claudePath: PICKED });
    const service = createSettingsService(
      {},
      mem.store,
      undefined,
      disk([PICKED], AUTO),
    );
    expect(await service.setClaudePath(null)).toMatchObject({
      claude: { path: AUTO, source: "auto" },
    });
    expect(mem.current()).toEqual({});
  });

  it("never takes the path through a patch (CC-12)", async () => {
    const service = createSettingsService(
      {},
      memoryStore().store,
      undefined,
      disk([PICKED]),
    );
    await expect(service.update({ claudePath: PICKED })).rejects.toThrow(
      InvalidSettings,
    );
  });
});
