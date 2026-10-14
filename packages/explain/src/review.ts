import type { Explanation, ReviewStatus } from "@code2n8n/model";
import { layerOne, type Problem } from "./checks";
import type { ChatMessage, LlmClient } from "./openrouter";
import {
  applyVerdicts,
  parseVerdicts,
  type ReviewedClaim,
  redraftMessage,
  reviewerMessage,
} from "./reviewer";
import { type Draft, parseExplanation } from "./schema";
import { splitSentences, toClaims } from "./sentences";

/** An explanation with every line RELATIVE to the node, as stored in the cache. */
export type StoredExplanation = Explanation;

export type ReviewOutcome =
  | { kind: "ok"; review: ReviewStatus; result: StoredExplanation }
  | { kind: "unfaithful" };

export interface ReviewInput {
  /** The user turn of the draft request (node name, kind, neighbours, numbered code). */
  user: string;
  /** Normalized node code. */
  code: string;
  /** Neighbour names: calls and called by. */
  neighbours: string[];
}

export interface ReviewDeps {
  llm: LlmClient;
  model: string;
  reviewModel: string;
  prompt: { text: string };
  reviewer: { text: string };
  /** When set, the summary keeps only its first sentences, before review (VID-28). */
  maxSentences?: number;
}

/** The draft plus at most 2 new drafts (FID-08). */
const ROUNDS = 3;

const jsonMode = (model: string) =>
  model.startsWith("google/") ? "prompt" : "native";

/** Builds the stored explanation from the kept claims; ids keep their gaps (FID-09). */
function toResult(draft: Draft, kept: ReviewedClaim[]): StoredExplanation {
  const plain = (kind: ReviewedClaim["kind"]) =>
    kept
      .filter((c) => c.kind === kind)
      .map(({ id, text, lines }) => ({ id, text, lines }));
  const sentences = plain("sentence");
  return {
    summary: sentences.map((s) => s.text).join(" "),
    sentences,
    inputs: plain("input"),
    outputs: plain("output"),
    suggestions: kept
      .filter((c) => c.kind === "suggestion")
      .map((c) => {
        const s = draft.suggestions[
          Number(c.id.slice(1)) - 1
        ] as Draft["suggestions"][number];
        return { id: c.id, ...s, lines: c.lines };
      }),
  };
}

/** Draft → layer one → reviewer, up to 3 rounds; then cut, or unfaithful when no summary sentence survives (C4). */
export async function reviewedDraft(
  input: ReviewInput,
  deps: ReviewDeps,
): Promise<ReviewOutcome> {
  const { llm, model, reviewModel, prompt, reviewer, maxSentences } = deps;
  const lineCount = input.code.split("\n").length;
  const ctx = { code: input.code, neighbours: input.neighbours };
  const base: ChatMessage[] = [
    { role: "system", content: prompt.text },
    { role: "user", content: input.user },
  ];
  let messages = base;

  for (let round = 1; ; round++) {
    const raw = await llm.complete({ model, messages, json: jsonMode(model) });
    const parsed = parseExplanation(raw, lineCount);
    const draft =
      maxSentences === undefined
        ? parsed
        : {
            ...parsed,
            summary: splitSentences(parsed.summary)
              .slice(0, maxSentences)
              .join(" "),
          };
    const claims = toClaims(draft);

    const rejected = layerOne(claims, ctx);
    const passed = claims.filter((c) => !rejected.some((p) => p.id === c.id));
    let kept: ReviewedClaim[] = [];
    let problems: Problem[] = rejected;
    if (passed.length > 0) {
      const answer = await llm.complete({
        model: reviewModel,
        messages: [
          { role: "system", content: reviewer.text },
          {
            role: "user",
            content: reviewerMessage(input.code, input.neighbours, passed),
          },
        ],
        json: jsonMode(reviewModel),
      });
      const applied = applyVerdicts(passed, parseVerdicts(answer), lineCount);
      kept = applied.kept;
      const order = (p: Problem) => claims.findIndex((c) => c.id === p.id);
      problems = [...rejected, ...applied.problems].sort(
        (a, b) => order(a) - order(b),
      );
    }

    if (problems.length > 0 && round < ROUNDS) {
      messages = [
        ...base,
        { role: "assistant", content: raw },
        { role: "user", content: redraftMessage(problems) },
      ];
      continue;
    }
    if (!kept.some((c) => c.kind === "sentence")) return { kind: "unfaithful" };
    return {
      kind: "ok",
      review: problems.length === 0 ? "full" : "cut",
      result: toResult(draft, kept),
    };
  }
}
