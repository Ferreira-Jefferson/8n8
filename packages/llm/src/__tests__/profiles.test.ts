import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, MODEL_PROFILES, profileOf } from "../profiles";

describe("profileOf", () => {
  it("gives the default profile to an unknown model", () => {
    expect(profileOf("openai/gpt-x")).toEqual({
      json: "native",
      reasoning: "default",
    });
    expect(profileOf("openai/gpt-x")).toBe(DEFAULT_PROFILE);
  });

  it("asks for prompt-only JSON on google/ models", () => {
    expect(profileOf("google/gemini-x")).toEqual({
      json: "prompt",
      reasoning: "default",
    });
  });

  it("matches google/ only as a prefix", () => {
    expect(profileOf("x/google/gemini")).toBe(DEFAULT_PROFILE);
  });

  it("turns reasoning off and fixes the routing for deepseek, with or without the ~ alias", () => {
    for (const model of [
      "deepseek/deepseek-v4",
      "~deepseek/deepseek-v4-flash-latest",
    ]) {
      expect(profileOf(model)).toEqual({
        json: "native",
        reasoning: "off",
        routing: {
          order: ["baidu/fp8", "wafer/fast", "atlas-cloud/fp4"],
          allowFallbacks: true,
        },
      });
    }
  });

  it("does not match deepseek in the middle of an id", () => {
    expect(profileOf("x/deepseek/y")).toBe(DEFAULT_PROFILE);
    expect(profileOf("deepseekish/y")).toBe(DEFAULT_PROFILE);
  });

  it("has no entry that equals the default profile", () => {
    for (const { profile } of MODEL_PROFILES) {
      expect(profile).not.toEqual(DEFAULT_PROFILE);
    }
  });
});
