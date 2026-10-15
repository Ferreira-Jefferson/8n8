import type { ChatMessage } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { openrouter } from "../openrouter";
import { fakeFetch } from "./fake-fetch";

const createOpenRouterClient = (
  apiKey: string,
  options: {
    fetch?: typeof globalThis.fetch;
    baseURL?: string | undefined;
  } = {},
) =>
  openrouter.create(
    {
      provider: "openrouter",
      apiKey,
      baseURL: options.baseURL,
      model: "m",
      reviewModel: "m",
    },
    { fetch: options.fetch },
  );

const messages: ChatMessage[] = [
  { role: "system", content: "sistema JSON" },
  { role: "user", content: "usuário" },
];

describe("createOpenRouterClient (CORE-16, CORE-21)", () => {
  it("makes exactly one POST to the OpenRouter chat endpoint with the bearer key", async () => {
    const { fetch, calls } = fakeFetch();
    await createOpenRouterClient("sk-test", { fetch }).complete({
      model: "~deepseek/deepseek-v4-flash-latest",
      messages,
      json: "native",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.authorization).toBe("Bearer sk-test");
  });

  it("sends the given model and messages in the body", async () => {
    const { fetch, calls } = fakeFetch();
    await createOpenRouterClient("k", { fetch }).complete({
      model: "openai/gpt-x",
      messages,
      json: "native",
    });
    expect(calls[0]?.body.model).toBe("openai/gpt-x");
    expect(calls[0]?.body.messages).toEqual(messages);
  });

  it("sets response_format json_object only in native mode", async () => {
    const native = fakeFetch();
    await createOpenRouterClient("k", { fetch: native.fetch }).complete({
      model: "openai/gpt-x",
      messages,
      json: "native",
    });
    expect(native.calls[0]?.body.response_format).toEqual({
      type: "json_object",
    });

    const prompt = fakeFetch();
    await createOpenRouterClient("k", { fetch: prompt.fetch }).complete({
      model: "google/gemini-x",
      messages,
      json: "prompt",
    });
    expect(prompt.calls[0]?.body).not.toHaveProperty("response_format");
  });

  it("disables reasoning for DeepSeek models only", async () => {
    const deepseek = fakeFetch();
    await createOpenRouterClient("k", { fetch: deepseek.fetch }).complete({
      model: "~deepseek/deepseek-v4-flash-latest",
      messages,
      json: "native",
    });
    expect(deepseek.calls[0]?.body.reasoning).toEqual({ enabled: false });

    const gemini = fakeFetch();
    await createOpenRouterClient("k", { fetch: gemini.fetch }).complete({
      model: "google/gemini-x",
      messages,
      json: "prompt",
    });
    expect(gemini.calls[0]?.body).not.toHaveProperty("reasoning");
  });

  it("asks fast providers first for DeepSeek models only, with fallback", async () => {
    const deepseek = fakeFetch();
    await createOpenRouterClient("k", { fetch: deepseek.fetch }).complete({
      model: "~deepseek/deepseek-v4-flash-latest",
      messages,
      json: "native",
    });
    expect(deepseek.calls[0]?.body.provider).toEqual({
      order: ["baidu/fp8", "wafer/fast", "atlas-cloud/fp4"],
      allow_fallbacks: true,
    });

    const gemini = fakeFetch();
    await createOpenRouterClient("k", { fetch: gemini.fetch }).complete({
      model: "google/gemini-x",
      messages,
      json: "prompt",
    });
    expect(gemini.calls[0]?.body).not.toHaveProperty("provider");
  });

  it("rejects after a single request on HTTP 500", async () => {
    const { fetch, calls } = fakeFetch(500);
    await expect(
      createOpenRouterClient("k", { fetch }).complete({
        model: "openai/gpt-x",
        messages,
        json: "native",
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("returns the content of the first choice", async () => {
    const { fetch } = fakeFetch(200, '{"summary":"Calcula."}');
    const content = await createOpenRouterClient("k", { fetch }).complete({
      model: "openai/gpt-x",
      messages,
      json: "native",
    });
    expect(content).toBe('{"summary":"Calcula."}');
  });

  it("posts to the configured baseURL", async () => {
    const { fetch, calls } = fakeFetch();
    await createOpenRouterClient("k", {
      fetch,
      baseURL: "http://127.0.0.1:9/v1",
    }).complete({ model: "openai/gpt-x", messages, json: "native" });
    expect(calls[0]?.url).toBe("http://127.0.0.1:9/v1/chat/completions");
  });

  it("sends an assistant message in the body in the given order (FID-08)", async () => {
    const { fetch, calls } = fakeFetch();
    const redraft: ChatMessage[] = [
      { role: "system", content: "sistema JSON" },
      { role: "user", content: "nó" },
      { role: "assistant", content: '{"summary":"rascunho"}' },
      { role: "user", content: "Problemas encontrados:" },
    ];
    await createOpenRouterClient("k", { fetch }).complete({
      model: "openai/gpt-x",
      messages: redraft,
      json: "native",
    });
    expect(calls[0]?.body.messages).toEqual(redraft);
  });

  it("omits response_format in native mode for a model whose profile says prompt", async () => {
    const { fetch, calls } = fakeFetch();
    await createOpenRouterClient("k", { fetch }).complete({
      model: "google/gemini-x",
      messages,
      json: "native",
    });
    expect(calls[0]?.body).not.toHaveProperty("response_format");
  });

  it("builds a client with the default fetch and base URL (nothing is sent)", () => {
    expect(createOpenRouterClient("k")).toHaveProperty("complete");
  });

  it("is configured only with a key", () => {
    const config = {
      provider: "openrouter",
      baseURL: undefined,
      model: "m",
      reviewModel: "m",
    };
    expect(openrouter.isConfigured({ ...config, apiKey: "k" })).toBe(true);
    expect(openrouter.isConfigured({ ...config, apiKey: undefined })).toBe(
      false,
    );
  });
});
