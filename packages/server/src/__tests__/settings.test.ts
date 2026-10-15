import type { LlmConfig } from "@8n8/llm";
import type { LlmClient, StoredSettings } from "@8n8/model";
import { describe, expect, it } from "vitest";
import {
  applyPatch,
  createSettingsService,
  InvalidSettings,
  type SettingsStore,
} from "../settings";

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
    const view = await createSettingsService({}, memoryStore().store).view();
    expect(view).toEqual({
      provider: "openrouter",
      model: DEFAULT_MODEL,
      autoSummary: false,
      autoSuggestions: false,
      hasKey: false,
      providers: [
        { id: "openrouter", defaultModel: DEFAULT_MODEL, usesKey: true },
        { id: "openai-compatible", defaultModel: "gpt-4o-mini", usesKey: true },
        { id: "claude-code", defaultModel: "sonnet", usesKey: false },
      ],
      env: {},
    });
  });

  it("shows the stored settings, says a key exists and never shows it", async () => {
    const { store } = memoryStore({
      apiKey: KEY,
      model: "m/x",
      baseURL: "http://127.0.0.1:9/v1",
      autoSummary: true,
    });
    const view = await createSettingsService({}, store).view();
    expect(view).toMatchObject({
      provider: "openrouter",
      model: "m/x",
      baseURL: "http://127.0.0.1:9/v1",
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
    const view = await createSettingsService(env, memoryStore().store).view();
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

  it("lets the environment flags win over the stored modes: 1/true and 0/false", async () => {
    const { store } = memoryStore({
      autoSummary: true,
      autoSuggestions: false,
    });
    const service = createSettingsService(
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
    expect(await createSettingsService({}, failing).view()).toMatchObject({
      hasKey: false,
      provider: "openrouter",
    });
  });
});

describe("update (CFG-13, CFG-14)", () => {
  it("stores the fields of the patch and answers the new view", async () => {
    const mem = memoryStore();
    const service = createSettingsService({}, mem.store);
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

  it("erases apiKey, baseURL and model with null", async () => {
    const mem = memoryStore({
      apiKey: KEY,
      baseURL: "http://127.0.0.1:9/v1",
      model: "m/x",
      autoSummary: true,
    });
    await createSettingsService({}, mem.store).update({
      apiKey: null,
      baseURL: null,
      model: null,
    });
    expect(mem.current()).toEqual({ autoSummary: true });
  });

  it.each([
    ["an unknown field", { apiKey: KEY, extra: 1 }],
    ["an unknown provider", { provider: "nope" }],
    ["a URL without http(s)", { baseURL: "ftp://x" }],
    ["a URL that is not a URL", { baseURL: "não é url" }],
    ["a javascript: URL", { baseURL: "javascript:alert(1)" }],
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
    const service = createSettingsService({}, mem.store);
    await expect(service.update(patch)).rejects.toBeInstanceOf(InvalidSettings);
    expect(mem.writes).toEqual([]);
    expect((await service.view()).hasKey).toBe(true);
  });

  it("runs writes one at a time, in order", async () => {
    const mem = memoryStore();
    const service = createSettingsService({}, mem.store);
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
  ])("accepts %s", async (model) => {
    const mem = memoryStore();
    await createSettingsService({}, mem.store).update({ model });
    expect(mem.current().model).toBe(model);
  });
});

describe("applyPatch: the key never follows a new destination (CFG-15)", () => {
  const stored = {
    apiKey: KEY,
    baseURL: "http://127.0.0.1:9/v1",
    model: "m/x",
  };

  it("erases the key when the URL changes", () => {
    expect(applyPatch(stored, { baseURL: "http://outro/v1" })).toEqual({
      baseURL: "http://outro/v1",
      model: "m/x",
    });
    expect(applyPatch(stored, { baseURL: null })).toEqual({ model: "m/x" });
  });

  it("erases the key, the URL and the model when the provider changes", () => {
    expect(applyPatch(stored, { provider: "openai-compatible" })).toEqual({
      provider: "openai-compatible",
    });
  });

  it("keeps a new key, URL and model brought by the same patch", () => {
    expect(
      applyPatch(stored, {
        provider: "openai-compatible",
        baseURL: "http://localhost:11434/v1",
        apiKey: "new-key",
        model: "llama",
      }),
    ).toEqual({
      provider: "openai-compatible",
      baseURL: "http://localhost:11434/v1",
      apiKey: "new-key",
      model: "llama",
    });
  });

  it("keeps the key when the URL and the provider stay the same", () => {
    expect(
      applyPatch(stored, {
        baseURL: "http://127.0.0.1:9/v1",
        provider: "openrouter",
        autoSummary: true,
      }),
    ).toEqual({ ...stored, provider: "openrouter", autoSummary: true });
  });
});

describe("llm (CFG-16, CFG-17)", () => {
  it("builds no client without a key, and one with the stored key", async () => {
    const f = factory();
    const mem = memoryStore();
    const service = createSettingsService({}, mem.store, f.createClient);
    expect((await service.llm()).client).toBeUndefined();
    await service.update({ apiKey: KEY });
    const { client, config } = await service.llm();
    expect(client).toBeDefined();
    expect(config).toMatchObject({ provider: "openrouter", apiKey: KEY });
  });

  it("builds a new client only when the settings change", async () => {
    const f = factory();
    const service = createSettingsService(
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
    const service = createSettingsService(
      { OPENROUTER_API_KEY: "env-key-0000000" },
      memoryStore({ apiKey: KEY }).store,
      f.createClient,
    );
    expect((await service.llm()).config.apiKey).toBe("env-key-0000000");
  });

  it("cuts the key from a provider error, whole and by its start (DIST-17)", async () => {
    const service = createSettingsService(
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
    expect(error).toBe("bad key [chave omitida] and [chave omitida]");
  });
});

describe("the claude-code provider through the settings (CC-01, CC-02, CC-12)", () => {
  // Any file that exists stands for the executable: the client is never called here.
  const exe = process.execPath;

  it("builds no client when the executable is missing: the pipeline answers no-key", async () => {
    const service = createSettingsService(
      { APP8N8_CLAUDE_PATH: `${exe}.nada` },
      memoryStore({ provider: "claude-code" }).store,
    );
    expect((await service.llm()).client).toBeUndefined();
  });

  it("builds a client with the executable named by the host environment", async () => {
    const service = createSettingsService(
      { APP8N8_CLAUDE_PATH: exe },
      memoryStore({ provider: "claude-code" }).store,
    );
    const { client, config } = await service.llm();
    expect(client).toBeDefined();
    expect(config).toMatchObject({ provider: "claude-code", model: "sonnet" });
  });

  it("shows no key and no key variable for claude-code", async () => {
    const view = await createSettingsService(
      { APP8N8_CLAUDE_PATH: exe, OPENROUTER_API_KEY: KEY },
      memoryStore({ provider: "claude-code" }).store,
    ).view();
    expect(view).toMatchObject({ provider: "claude-code", hasKey: false });
    expect(view.env).toEqual({});
  });

  it("refuses a path to the executable through a patch", async () => {
    const mem = memoryStore();
    const service = createSettingsService({}, mem.store);
    for (const field of ["claudePath", "executable", "APP8N8_CLAUDE_PATH"]) {
      await expect(
        service.update({ provider: "claude-code", [field]: "C:/x.exe" }),
      ).rejects.toBeInstanceOf(InvalidSettings);
    }
    expect(mem.writes).toEqual([]);
  });
});
