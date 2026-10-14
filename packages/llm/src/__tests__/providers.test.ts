import { describe, expect, it } from "vitest";
import { createLlmClient, PROVIDERS, providerOf } from "../providers";
import { fakeFetch } from "./fake-fetch";

const config = (provider: string, apiKey?: string, baseURL?: string) => ({
  provider,
  apiKey,
  baseURL,
  model: "m",
  reviewModel: "m",
});

describe("providerOf", () => {
  it("finds each registered provider by id", () => {
    for (const p of PROVIDERS) expect(providerOf(p.id)).toBe(p);
    expect(PROVIDERS.map((p) => p.id)).toEqual([
      "openrouter",
      "openai-compatible",
    ]);
  });

  it("throws, naming the known ids, on an unknown id", () => {
    expect(() => providerOf("nope")).toThrow(
      'Provedor de LLM desconhecido: "nope". Use um destes: openrouter, openai-compatible.',
    );
  });
});

describe("createLlmClient", () => {
  it("returns undefined when the provider is not configured", () => {
    expect(createLlmClient(config("openrouter"))).toBeUndefined();
    expect(createLlmClient(config("openai-compatible"))).toBeUndefined();
  });

  it("returns a client of the configured provider, wired to the given fetch", async () => {
    const or = fakeFetch();
    await createLlmClient(config("openrouter", "k"), {
      fetch: or.fetch,
    })?.complete({ model: "m", messages: [], json: "native" });
    expect(or.calls[0]?.url).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );

    const oc = fakeFetch();
    await createLlmClient(
      config("openai-compatible", undefined, "http://l/v1"),
      { fetch: oc.fetch },
    )?.complete({ model: "m", messages: [], json: "native" });
    expect(oc.calls[0]?.url).toBe("http://l/v1/chat/completions");
  });

  it("throws on an unknown provider", () => {
    expect(() => createLlmClient(config("nope", "k"))).toThrow(/desconhecido/);
  });
});
