import type { ChatMessage } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { openai } from "../openai";
import { fakeFetch } from "./fake-fetch";

const messages: ChatMessage[] = [
  { role: "system", content: "sistema JSON" },
  { role: "user", content: "usuário" },
];

const config = (apiKey?: string, baseURL?: string) => ({
  provider: "openai",
  apiKey,
  baseURL,
  model: "gpt-5-nano",
  reviewModel: "gpt-5-nano",
});

describe("openai", () => {
  it("posts to the official URL with the bearer key", async () => {
    const { fetch, calls } = fakeFetch();
    await openai
      .create(config("sk-1"), { fetch })
      .complete({ model: "gpt-5-nano", messages, json: "native" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]?.authorization).toBe("Bearer sk-1");
    expect(calls[0]?.body.model).toBe("gpt-5-nano");
    expect(calls[0]?.body.response_format).toEqual({ type: "json_object" });
  });

  it("ignores a base URL: the address is the official one", async () => {
    const { fetch, calls } = fakeFetch();
    await openai
      .create(config("k", "http://localhost:1/v1"), { fetch })
      .complete({ model: "m", messages, json: "native" });
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("is configured only with a key", () => {
    expect(openai.isConfigured(config("k"))).toBe(true);
    expect(openai.isConfigured(config())).toBe(false);
  });

  it("defaults to gpt-5-nano and reads OPENAI_API_KEY", () => {
    expect(openai.defaultModel).toBe("gpt-5-nano");
    expect(openai.env).toEqual({ apiKey: "OPENAI_API_KEY" });
  });
});
