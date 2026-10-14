import type { ChatMessage } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { openaiCompatible } from "../openai-compatible";
import { fakeFetch } from "./fake-fetch";

const messages: ChatMessage[] = [
  { role: "system", content: "sistema JSON" },
  { role: "user", content: "usuário" },
];

const config = (apiKey?: string, baseURL?: string) => ({
  provider: "openai-compatible",
  apiKey,
  baseURL,
  model: "m",
  reviewModel: "m",
});

describe("openaiCompatible", () => {
  it("posts to the given baseURL with the bearer key", async () => {
    const { fetch, calls } = fakeFetch();
    await openaiCompatible
      .create(config("sk-1", "http://localhost:11434/v1"), { fetch })
      .complete({ model: "llama3", messages, json: "native" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.authorization).toBe("Bearer sk-1");
    expect(calls[0]?.body.model).toBe("llama3");
    expect(calls[0]?.body.messages).toEqual(messages);
  });

  it("works without a key, for a local server", async () => {
    const { fetch, calls } = fakeFetch(200, "oi");
    const content = await openaiCompatible
      .create(config(undefined, "http://localhost:1234/v1"), { fetch })
      .complete({ model: "x", messages, json: "native" });
    expect(content).toBe("oi");
    expect(calls[0]?.authorization).toBe("Bearer not-needed");
    expect(calls[0]?.url).toBe("http://localhost:1234/v1/chat/completions");
  });

  it("defaults to the OpenAI URL", async () => {
    const { fetch, calls } = fakeFetch();
    await openaiCompatible
      .create(config("k"), { fetch })
      .complete({ model: "gpt-x", messages, json: "native" });
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("builds a client with the default fetch (nothing is sent)", () => {
    expect(openaiCompatible.create(config("k"))).toHaveProperty("complete");
  });

  it("sets response_format by the profile, and sends no OpenRouter extension", async () => {
    const native = fakeFetch();
    await openaiCompatible
      .create(config("k"), { fetch: native.fetch })
      .complete({ model: "~deepseek/x", messages, json: "native" });
    expect(native.calls[0]?.body.response_format).toEqual({
      type: "json_object",
    });
    expect(native.calls[0]?.body).not.toHaveProperty("reasoning");
    expect(native.calls[0]?.body).not.toHaveProperty("provider");

    const profile = fakeFetch();
    await openaiCompatible
      .create(config("k"), { fetch: profile.fetch })
      .complete({ model: "google/gemini-x", messages, json: "native" });
    expect(profile.calls[0]?.body).not.toHaveProperty("response_format");

    const asked = fakeFetch();
    await openaiCompatible
      .create(config("k"), { fetch: asked.fetch })
      .complete({ model: "gpt-x", messages, json: "prompt" });
    expect(asked.calls[0]?.body).not.toHaveProperty("response_format");
  });

  it("rejects after a single request on HTTP 500", async () => {
    const { fetch, calls } = fakeFetch(500);
    await expect(
      openaiCompatible
        .create(config("k"), { fetch })
        .complete({ model: "m", messages, json: "native" }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("is configured with a key, a base URL, or both; not with neither", () => {
    expect(openaiCompatible.isConfigured(config("k"))).toBe(true);
    expect(
      openaiCompatible.isConfigured(config(undefined, "http://x/v1")),
    ).toBe(true);
    expect(openaiCompatible.isConfigured(config("k", "http://x/v1"))).toBe(
      true,
    );
    expect(openaiCompatible.isConfigured(config())).toBe(false);
  });
});
