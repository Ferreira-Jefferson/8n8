import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  diffReasons,
  type Fingerprint,
  fingerprintOf,
  neighbourKey,
  normalizeCode,
} from "../fingerprint";

const deps = {
  model: "m/resumo",
  reviewModel: "m/revisor",
  prompt: { version: "aaaaaaaaaaaa" },
  reviewer: { version: "bbbbbbbbbbbb" },
};

const req = {
  code: "def f(peso):\n    return peso * 2",
  calls: ["b", "a"],
  calledBy: ["c"],
};

describe("normalizeCode", () => {
  it("turns CRLF and CR into LF", () => {
    expect(normalizeCode("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("removes trailing spaces and tabs from each line", () => {
    expect(normalizeCode("a  \t\n  b\t\nc ")).toBe("a\n  b\nc");
  });

  it("keeps the number of lines", () => {
    const code = "a \r\n\r\n  \r\nb\t";
    expect(normalizeCode(code).split("\n")).toHaveLength(4);
  });
});

describe("fingerprintOf (CACHE-01)", () => {
  it("has the six components apart", () => {
    const sha = (t: string) => createHash("sha256").update(t).digest("hex");
    expect(fingerprintOf(req, deps)).toEqual({
      code: sha(req.code),
      neighbours: sha(JSON.stringify({ calls: ["a", "b"], calledBy: ["c"] })),
      model: "m/resumo",
      reviewModel: "m/revisor",
      promptVersion: "aaaaaaaaaaaa",
      reviewerVersion: "bbbbbbbbbbbb",
    });
  });

  it("gives the same code component for the same code with CRLF and with LF", () => {
    const crlf = { ...req, code: req.code.replace(/\n/g, "\r\n") };
    expect(fingerprintOf(crlf, deps).code).toBe(fingerprintOf(req, deps).code);
  });
});

describe("neighbourKey", () => {
  it("does not change with order or repetition", () => {
    expect(neighbourKey(["b", "a", "a"], ["d", "c", "d"])).toBe(
      neighbourKey(["a", "b"], ["c", "d"]),
    );
  });

  it("changes when a name moves from calls to calledBy", () => {
    expect(neighbourKey(["a"], ["b"])).not.toBe(neighbourKey([], ["a", "b"]));
  });
});

describe("diffReasons (CACHE-03, CACHE-04)", () => {
  const old: Fingerprint = fingerprintOf(req, deps);

  it("returns [] when nothing changed", () => {
    expect(diffReasons(old, { ...old })).toEqual([]);
  });

  it("returns ['code'] when only the code changed", () => {
    expect(diffReasons(old, { ...old, code: "x" })).toEqual(["code"]);
  });

  it("returns ['neighbours'] when only the neighbours changed", () => {
    expect(diffReasons(old, { ...old, neighbours: "x" })).toEqual([
      "neighbours",
    ]);
  });

  it.each([
    "model",
    "reviewModel",
    "promptVersion",
    "reviewerVersion",
  ] as const)("returns ['model-or-prompt'] when only %s changed", (field) => {
    expect(diffReasons(old, { ...old, [field]: "x" })).toEqual([
      "model-or-prompt",
    ]);
  });

  it("returns all three reasons in the fixed order when everything changed", () => {
    const now: Fingerprint = {
      code: "1",
      neighbours: "2",
      model: "3",
      reviewModel: "4",
      promptVersion: "5",
      reviewerVersion: "6",
    };
    expect(diffReasons(old, now)).toEqual([
      "code",
      "neighbours",
      "model-or-prompt",
    ]);
  });
});
