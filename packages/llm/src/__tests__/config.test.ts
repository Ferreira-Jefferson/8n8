import { describe, expect, it } from "vitest";
import { resolveLlmConfig } from "../config";

const DEFAULT_MODEL = "~deepseek/deepseek-v4-flash-latest";

describe("resolveLlmConfig: provider", () => {
  it("defaults to openrouter when the variable is absent or empty", () => {
    expect(resolveLlmConfig({}).provider).toBe("openrouter");
    expect(resolveLlmConfig({ APP8N8_LLM_PROVIDER: "" }).provider).toBe(
      "openrouter",
    );
  });

  it("uses APP8N8_LLM_PROVIDER when it is set", () => {
    expect(
      resolveLlmConfig({ APP8N8_LLM_PROVIDER: "openai-compatible" }).provider,
    ).toBe("openai-compatible");
  });

  it("throws on an unknown provider", () => {
    expect(() => resolveLlmConfig({ APP8N8_LLM_PROVIDER: "nope" })).toThrow(
      /desconhecido/,
    );
  });

  it("uses the default the host gives when nothing chooses a provider (CC-15)", () => {
    expect(resolveLlmConfig({}, {}, "claude-code")).toMatchObject({
      provider: "claude-code",
      model: "claude-sonnet-5-5",
    });
    expect(
      resolveLlmConfig({ APP8N8_LLM_PROVIDER: "openai" }, {}, "claude-code")
        .provider,
    ).toBe("openai");
    expect(
      resolveLlmConfig({}, { provider: "anthropic" }, "claude-code").provider,
    ).toBe("anthropic");
  });

  it("reads a key or model stored with no provider as openrouter's, whatever the default (CC-15)", () => {
    expect(resolveLlmConfig({}, { apiKey: "k" }, "claude-code")).toMatchObject({
      provider: "openrouter",
      apiKey: "k",
    });
    expect(resolveLlmConfig({}, { model: "m" }, "claude-code")).toMatchObject({
      provider: "openrouter",
      model: "m",
    });
  });

  it("carries the picked Claude Code path, whatever the provider (CC-16)", () => {
    expect(
      resolveLlmConfig({}, { claudePath: "D:\\c\\claude.exe" }).claudePath,
    ).toBe("D:\\c\\claude.exe");
    expect(resolveLlmConfig({}, { claudePath: "" }).claudePath).toBeUndefined();
  });
});

describe("resolveLlmConfig: key and base URL", () => {
  it("reads OPENROUTER_* for openrouter; absent or empty gives undefined", () => {
    expect(
      resolveLlmConfig({
        OPENROUTER_API_KEY: "k",
        OPENROUTER_BASE_URL: "http://127.0.0.1:9/v1",
      }),
    ).toMatchObject({ apiKey: "k", baseURL: "http://127.0.0.1:9/v1" });
    expect(resolveLlmConfig({})).toMatchObject({
      apiKey: undefined,
      baseURL: undefined,
    });
    expect(
      resolveLlmConfig({ OPENROUTER_API_KEY: "", OPENROUTER_BASE_URL: "" }),
    ).toMatchObject({ apiKey: undefined, baseURL: undefined });
  });

  it("reads APP8N8_LLM_* for openai-compatible; absent or empty gives undefined", () => {
    const base = { APP8N8_LLM_PROVIDER: "openai-compatible" };
    expect(
      resolveLlmConfig({
        ...base,
        APP8N8_LLM_API_KEY: "k",
        APP8N8_LLM_BASE_URL: "http://localhost:11434/v1",
      }),
    ).toMatchObject({ apiKey: "k", baseURL: "http://localhost:11434/v1" });
    expect(resolveLlmConfig(base)).toMatchObject({
      apiKey: undefined,
      baseURL: undefined,
    });
    expect(
      resolveLlmConfig({
        ...base,
        APP8N8_LLM_API_KEY: "",
        APP8N8_LLM_BASE_URL: "",
      }),
    ).toMatchObject({ apiKey: undefined, baseURL: undefined });
  });

  it("ignores the variables of the other provider", () => {
    expect(
      resolveLlmConfig({
        APP8N8_LLM_API_KEY: "x",
        APP8N8_LLM_BASE_URL: "http://x",
      }),
    ).toMatchObject({ apiKey: undefined, baseURL: undefined });
    expect(
      resolveLlmConfig({
        APP8N8_LLM_PROVIDER: "openai-compatible",
        OPENROUTER_API_KEY: "x",
        OPENROUTER_BASE_URL: "http://x",
      }),
    ).toMatchObject({ apiKey: undefined, baseURL: undefined });
  });
});

describe("resolveLlmConfig: model (CORE-21)", () => {
  it("uses APP8N8_MODEL when it is set", () => {
    expect(resolveLlmConfig({ APP8N8_MODEL: "google/gemini-x" }).model).toBe(
      "google/gemini-x",
    );
  });

  it("falls back to the default model of openrouter when the variable is absent", () => {
    expect(resolveLlmConfig({}).model).toBe(DEFAULT_MODEL);
  });

  it("falls back to the default model when the variable is empty", () => {
    expect(resolveLlmConfig({ APP8N8_MODEL: "" }).model).toBe(DEFAULT_MODEL);
  });

  it("each provider has its own default model", () => {
    expect(
      resolveLlmConfig({ APP8N8_LLM_PROVIDER: "openai-compatible" }).model,
    ).toBe("gpt-4o-mini");
  });
});

describe("resolveLlmConfig: reviewer model (FID-15)", () => {
  it("uses APP8N8_REVIEW_MODEL when it is set", () => {
    expect(
      resolveLlmConfig({
        APP8N8_REVIEW_MODEL: "r/x",
        APP8N8_MODEL: "google/gemini-x",
      }).reviewModel,
    ).toBe("r/x");
  });

  it("falls back to the summary model when the variable is absent", () => {
    expect(
      resolveLlmConfig({ APP8N8_MODEL: "google/gemini-x" }).reviewModel,
    ).toBe("google/gemini-x");
    expect(resolveLlmConfig({}).reviewModel).toBe(DEFAULT_MODEL);
  });

  it("treats an empty variable as absent", () => {
    expect(
      resolveLlmConfig({
        APP8N8_REVIEW_MODEL: "",
        APP8N8_MODEL: "google/gemini-x",
      }).reviewModel,
    ).toBe("google/gemini-x");
    expect(resolveLlmConfig({ APP8N8_REVIEW_MODEL: "" }).reviewModel).toBe(
      DEFAULT_MODEL,
    );
  });
});

describe("resolveLlmConfig: stored settings (CFG-16)", () => {
  const STORED = {
    provider: "openai-compatible",
    apiKey: "stored-key",
    model: "llama-x",
  };

  it("uses the stored provider, key and model when the environment sets none; the URL never comes from the store", () => {
    expect(resolveLlmConfig({}, STORED)).toEqual({
      provider: "openai-compatible",
      apiKey: "stored-key",
      baseURL: undefined,
      model: "llama-x",
      reviewModel: "llama-x",
    });
  });

  it("lets each environment variable win over its stored field, one by one", () => {
    const base = { APP8N8_LLM_PROVIDER: "openai-compatible" };
    expect(
      resolveLlmConfig({ ...base, APP8N8_LLM_API_KEY: "env-key" }, STORED),
    ).toMatchObject({ apiKey: "env-key", baseURL: undefined });
    expect(
      resolveLlmConfig({ ...base, APP8N8_LLM_BASE_URL: "http://env" }, STORED),
    ).toMatchObject({ apiKey: "stored-key", baseURL: "http://env" });
    expect(
      resolveLlmConfig({ ...base, APP8N8_MODEL: "env-model" }, STORED),
    ).toMatchObject({ model: "env-model", apiKey: "stored-key" });
  });

  it("an empty variable does not win over a stored field (CORE-21)", () => {
    expect(
      resolveLlmConfig({ APP8N8_LLM_API_KEY: "", APP8N8_MODEL: "" }, STORED),
    ).toMatchObject({ apiKey: "stored-key", model: "llama-x" });
  });

  it("never sends a stored key or model to another provider chosen by the environment", () => {
    expect(
      resolveLlmConfig({ APP8N8_LLM_PROVIDER: "openrouter" }, STORED),
    ).toEqual({
      provider: "openrouter",
      apiKey: undefined,
      baseURL: undefined,
      model: DEFAULT_MODEL,
      reviewModel: DEFAULT_MODEL,
    });
  });

  it("applies stored fields without a stored provider to the default provider only", () => {
    const loose = { apiKey: "stored-key", model: "m/x" };
    expect(resolveLlmConfig({}, loose)).toMatchObject({
      provider: "openrouter",
      apiKey: "stored-key",
      model: "m/x",
    });
    expect(
      resolveLlmConfig({ APP8N8_LLM_PROVIDER: "openai-compatible" }, loose),
    ).toMatchObject({ apiKey: undefined, model: "gpt-4o-mini" });
  });

  it("ignores a stored provider no registry entry knows, with its fields", () => {
    expect(
      resolveLlmConfig({}, { provider: "nope", apiKey: "stored-key" }),
    ).toMatchObject({ provider: "openrouter", apiKey: undefined });
  });

  it("treats empty stored values as absent", () => {
    expect(resolveLlmConfig({}, { apiKey: "", model: "" })).toMatchObject({
      apiKey: undefined,
      model: DEFAULT_MODEL,
    });
  });
});
