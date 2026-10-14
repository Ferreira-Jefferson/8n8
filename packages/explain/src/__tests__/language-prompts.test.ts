import { describe, expect, it } from "vitest";
import { docstringOmitted } from "../language";
import { buildStepPrompt, buildSystemPrompt } from "../prompt";
import { buildReviewerPrompt } from "../reviewer";
import { buildTitlePrompt } from "../title-prompt";
import { buildTitleReviewerPrompt } from "../title-reviewer";
import { PY } from "./py";

const TS = { label: "TypeScript", commentPrefix: "//" };

describe("docstringOmitted", () => {
  it.each([
    ["#", "# docstring omitida"],
    ["//", "// docstring omitida"],
    ["--", "-- docstring omitida"],
  ])("writes the marker for the prefix %s", (prefix, marker) => {
    expect(docstringOmitted(prefix)).toBe(marker);
  });
});

describe("prompts by language (6.1, 6.2)", () => {
  const builders: [
    string,
    (l: typeof PY) => { text: string; version: string },
  ][] = [
    ["system", (l) => buildSystemPrompt("REGRAS", l)],
    ["step", (l) => buildStepPrompt("REGRAS", l)],
    ["reviewer", (l) => buildReviewerPrompt(l)],
    ["title", (l) => buildTitlePrompt("REGRAS", l)],
    ["title reviewer", (l) => buildTitleReviewerPrompt(l)],
  ];

  it.each(builders)(
    "%s prompt names the language and not another",
    (_, build) => {
      const { text } = build(TS);
      expect(text).toContain("TypeScript");
      expect(text).not.toContain("Python");
      expect(build(PY).text).toContain("Python");
    },
  );

  it.each(builders)(
    "%s prompt has a version of its own per language",
    (_, build) => {
      expect(build(TS).version).not.toBe(build(PY).version);
      expect(build(TS).version).toBe(build(TS).version);
    },
  );

  it("the explain prompts show the marker of the language, not the Python one", () => {
    for (const { text } of [
      buildSystemPrompt("REGRAS", TS),
      buildStepPrompt("REGRAS", TS),
    ]) {
      expect(text).toContain("`// docstring omitida`");
      expect(text).not.toContain("# docstring omitida");
    }
    for (const { text } of [
      buildSystemPrompt("REGRAS", PY),
      buildStepPrompt("REGRAS", PY),
    ]) {
      expect(text).toContain("`# docstring omitida`");
    }
  });
});
