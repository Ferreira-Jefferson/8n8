import type {
  ChatMessage,
  ExplainPart,
  LlmClient,
  ReviewStatus,
  Suggestion,
  Summary,
} from "@8n8/model";
import { layerOne, type Problem } from "./checks";
import {
  applyVerdicts,
  parseVerdicts,
  type ReviewedClaim,
  redraftMessage,
  reviewerMessage,
} from "./reviewer";
import { type Draft, parseSuggestions, parseSummary } from "./schema";
import { splitSentences, toClaims } from "./sentences";

/** The kept claims of one draft, every line RELATIVE to the node; a part keeps its own piece. */
export type Reviewed = Summary & { suggestions: Suggestion[] };

export type ReviewOutcome =
  | { kind: "ok"; review: ReviewStatus; result: Reviewed }
  | { kind: "unfaithful" };

export interface ReviewInput {
  /** The user turn of the draft request (node name, kind, neighbours, numbered code). */
  user: string;
  /** Normalized node code. */
  code: string;
  /** Neighbour names: calls and called by. */
  neighbours: string[];
  /** Line of the docstring inside `code`; set only when the request had one. */
  docstringLine?: number;
}

const MAX_SUGGESTIONS = 5;

/** A docstring that does not reflect the code becomes the first suggestion; the 5-suggestion cap holds. */
function withDocstringSuggestion(
  draft: Draft,
  line: number | undefined,
  lineCount: number,
): Draft {
  if (
    draft.docstring?.reflects !== false ||
    line === undefined ||
    line < 1 ||
    line > lineCount
  ) {
    return draft;
  }
  const reason = draft.docstring.reason.trim().replace(/\.+$/, "");
  return {
    ...draft,
    suggestions: [
      {
        command: `Atualize a docstring: ${reason}`,
        reason: "A docstring não reflete o que o código faz.",
        line,
        severity: "media" as const,
      },
      ...draft.suggestions,
    ].slice(0, MAX_SUGGESTIONS),
  };
}

export interface ReviewDeps {
  llm: LlmClient;
  /** Picks the parser; only a summary with no surviving sentence is unfaithful (CFG-01, CFG-02). */
  part: ExplainPart;
  model: string;
  reviewModel: string;
  prompt: { text: string };
  reviewer: { text: string };
  /** When set, the summary keeps only its first sentences, before review (VID-28). */
  maxSentences?: number;
}

/** The draft plus at most 2 new drafts (FID-08). */
const ROUNDS = 3;

/** Builds the stored explanation from the kept claims; ids keep their gaps (FID-09). */
function toResult(draft: Draft, kept: ReviewedClaim[]): Reviewed {
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
  const { llm, part, model, reviewModel, prompt, reviewer, maxSentences } =
    deps;
  const lineCount = input.code.split("\n").length;
  const ctx = { code: input.code, neighbours: input.neighbours };
  const base: ChatMessage[] = [
    { role: "system", content: prompt.text },
    { role: "user", content: input.user },
  ];
  let messages = base;

  for (let round = 1; ; round++) {
    // "native" asks for JSON; the client downgrades it when the model profile says so.
    const raw = await llm.complete({ model, messages, json: "native" });
    const parsed =
      part === "summary" ? parseSummary(raw) : parseSuggestions(raw, lineCount);
    const capped =
      maxSentences === undefined
        ? parsed
        : {
            ...parsed,
            summary: splitSentences(parsed.summary)
              .slice(0, maxSentences)
              .join(" "),
          };
    const draft = withDocstringSuggestion(
      capped,
      input.docstringLine,
      lineCount,
    );
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
        json: "native",
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
    if (part === "summary" && !kept.some((c) => c.kind === "sentence")) {
      return { kind: "unfaithful" };
    }
    return {
      kind: "ok",
      review: problems.length === 0 ? "full" : "cut",
      result: toResult(draft, kept),
    };
  }
}
