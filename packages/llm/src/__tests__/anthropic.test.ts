import type { ChatMessage } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { anthropic } from "../anthropic";

const messages: ChatMessage[] = [
  { role: "system", content: "sistema JSON" },
  { role: "user", content: "usuário" },
];

const config = (apiKey?: string) => ({
  provider: "anthropic",
  apiKey,
  baseURL: undefined,
  model: "claude-haiku-5-5",
  reviewModel: "claude-haiku-5-5",
});

/** A fetch that records the request and answers like the Messages API. */
function fakeMessages(
  status = 200,
  blocks: unknown[] = [{ type: "text", text: "ok" }],
) {
  const calls: {
    url: string;
    apiKey: string | null;
    body: Record<string, unknown>;
  }[] = [];
  const fetch = async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      apiKey: new Headers(init?.headers).get("x-api-key"),
      body: JSON.parse(String(init?.body)),
    });
    const payload =
      status === 200
        ? {
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: "m",
            content: blocks,
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          }
        : { type: "error", error: { type: "api_error", message: "boom" } };
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

describe("anthropic", () => {
  it("posts to the Messages API with the key, the system apart and a token cap", async () => {
    const { fetch, calls } = fakeMessages();
    const text = await anthropic
      .create(config("sk-ant-1"), { fetch })
      .complete({ model: "claude-haiku-5-5", messages, json: "native" });
    expect(text).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]?.apiKey).toBe("sk-ant-1");
    expect(calls[0]?.body).toMatchObject({
      model: "claude-haiku-5-5",
      system: "sistema JSON",
      max_tokens: 4096,
      messages: [{ role: "user", content: "usuário" }],
    });
  });

  it("sends no system field when there is no system message", async () => {
    const { fetch, calls } = fakeMessages();
    await anthropic.create(config("k"), { fetch }).complete({
      model: "m",
      messages: [messages[1] as ChatMessage],
      json: "prompt",
    });
    expect(calls[0]?.body).not.toHaveProperty("system");
  });

  it("joins the text blocks and skips the others", async () => {
    const { fetch } = fakeMessages(200, [
      { type: "thinking", thinking: "x", signature: "s" },
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]);
    expect(
      await anthropic
        .create(config("k"), { fetch })
        .complete({ model: "m", messages, json: "native" }),
    ).toBe("ab");
  });

  it("rejects after a single request on HTTP 500", async () => {
    const { fetch, calls } = fakeMessages(500);
    await expect(
      anthropic
        .create(config("k"), { fetch })
        .complete({ model: "m", messages, json: "native" }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("is configured only with a key, defaults to Haiku and reads ANTHROPIC_API_KEY", () => {
    expect(anthropic.isConfigured(config("k"))).toBe(true);
    expect(anthropic.isConfigured(config())).toBe(false);
    expect(anthropic.defaultModel).toBe("claude-haiku-5-5");
    expect(anthropic.env).toEqual({ apiKey: "ANTHROPIC_API_KEY" });
  });

  it("builds a client with the default fetch (nothing is sent)", () => {
    expect(anthropic.create(config("k"))).toHaveProperty("complete");
  });
});
