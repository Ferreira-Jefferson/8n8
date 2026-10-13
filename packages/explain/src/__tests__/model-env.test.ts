import { describe, expect, it } from "vitest";
import { resolveModel } from "../model-env";

const DEFAULT_MODEL = "~deepseek/deepseek-v4-flash-latest";

describe("resolveModel (CORE-21)", () => {
  it("uses CODE2N8N_MODEL when it is set", () => {
    expect(resolveModel({ CODE2N8N_MODEL: "google/gemini-x" })).toBe(
      "google/gemini-x",
    );
  });

  it("falls back to the default model when the variable is absent", () => {
    expect(resolveModel({})).toBe(DEFAULT_MODEL);
  });

  it("falls back to the default model when the variable is empty", () => {
    expect(resolveModel({ CODE2N8N_MODEL: "" })).toBe(DEFAULT_MODEL);
  });
});
