import { describe, expect, it } from "vitest";
import {
  type ExplainKind,
  explainStyle,
  STEP_SENTENCE_LIMIT,
  TITLE_MAX_WORDS,
} from "../explanation";

describe("explainStyle", () => {
  it.each<ExplainKind>(["function", "class", "module"])(
    "returns the full style for %s",
    (kind) => {
      expect(explainStyle(kind)).toBe("full");
    },
  );

  it.each<ExplainKind>([
    "code",
    "call",
    "external",
    "condition",
    "loop",
    "block",
    "return",
  ])("returns the step style for %s", (kind) => {
    expect(explainStyle(kind)).toBe("step");
  });
});

describe("limits", () => {
  it("caps a step summary at 2 sentences (VID-28)", () => {
    expect(STEP_SENTENCE_LIMIT).toBe(2);
  });

  it("caps a title at 6 words (VID-14)", () => {
    expect(TITLE_MAX_WORDS).toBe(6);
  });
});
