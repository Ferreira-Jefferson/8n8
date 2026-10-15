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
