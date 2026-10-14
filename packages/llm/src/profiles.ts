/** What a model needs that the pipeline must not know: JSON mode, reasoning and routing. */
export interface ModelProfile {
  /** "native" sends response_format json_object; "prompt" relies on the prompt alone. */
  json: "native" | "prompt";
  /** "off" asks the provider to skip reasoning (cuts latency). Only providers that support it apply it. */
  reasoning: "default" | "off";
  /** Providers to try first, with fallback. Only OpenRouter applies it. */
  routing?: { order: string[]; allowFallbacks: boolean };
}

export const DEFAULT_PROFILE: ModelProfile = {
  json: "native",
  reasoning: "default",
};

/** The first entry whose `match` accepts the model id wins; no match gives DEFAULT_PROFILE. */
export const MODEL_PROFILES: { match: RegExp; profile: ModelProfile }[] = [
  // Gemini does not take response_format here.
  { match: /^google\//, profile: { ...DEFAULT_PROFILE, json: "prompt" } },
  // DeepSeek reasons by default; off cuts latency.
  // Default routing favours price and lands on providers that take 11–20 s; these answered in ~2 s with the least spread (2026-10-14).
  {
    match: /^~?deepseek\//,
    profile: {
      ...DEFAULT_PROFILE,
      reasoning: "off",
      routing: {
        order: ["baidu/fp8", "wafer/fast", "atlas-cloud/fp4"],
        allowFallbacks: true,
      },
    },
  },
];

export function profileOf(model: string): ModelProfile {
  return (
    MODEL_PROFILES.find((entry) => entry.match.test(model))?.profile ??
    DEFAULT_PROFILE
  );
}
