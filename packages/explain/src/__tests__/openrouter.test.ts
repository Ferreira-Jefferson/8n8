import { describe, expect, it } from "vitest";
import { type ChatMessage, createOpenRouterClient } from "../openrouter";

interface Captured {
  url: string;
  method: string | undefined;
  authorization: string | null;
  body: Record<string, unknown>;
}

function fakeFetch(status = 200, content = '{"summary":"ok"}') {
  const calls: Captured[] = [];
  const fetch = async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    const payload =
      status === 200
        ? {
            id: "gen-1",
            object: "chat.completion",
            created: 0,
            model: "m",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content },
              },
            ],
          }
        : { error: { message: "boom" } };
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

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
});
