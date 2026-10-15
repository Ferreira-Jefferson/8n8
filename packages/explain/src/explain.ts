import {
  type ExplainKind,
  type ExplainPart,
  type ExplainRequest,
  type ExplainResponse,
  explainStyle,
  type LlmClient,
  STEP_SENTENCE_LIMIT,
  type Suggestion,
  type SuggestionsResponse,
  type Summary,
  type SummaryResponse,
} from "@8n8/model";
import type { PartCache } from "./cache";
import { diffReasons, fingerprintOf, normalizeCode } from "./fingerprint";
import { type Reviewed, type ReviewOutcome, reviewedDraft } from "./review";

export interface ExplainDeps {
  /** Absent when no LLM provider is configured (CORE-19). */
  llm?: LlmClient | undefined;
  summaryCache: PartCache<Summary>;
  suggestionsCache: PartCache<Suggestion[]>;
  /** Id of the LLM provider; joins the fingerprint. */
  provider: string;
  model: string;
  /** Model of the reviewer (FID-15). */
  reviewModel: string;
  prompts: {
    summary: { text: string; version: string };
    /** Summary of a step inside a function (VID-28). */
    stepSummary: { text: string; version: string };
    suggestions: { text: string; version: string };
  };
  reviewer: { text: string; version: string };
}

export interface ExplainOptions {
  /** Answer from the cache only: a miss is `not-cached` and the LLM is never called (CFG-05). */
  cachedOnly?: boolean;
}

export const KIND_LABEL: Record<ExplainKind, string> = {
  function: "função",
  class: "classe",
  module: "código solto",
  code: "passo de código",
  call: "chamada de função",
  external: "chamada externa",
  condition: "condição",
  loop: "laço",
  block: "bloco",
  return: "retorno",
};

function userMessage(req: ExplainRequest): string {
  const numbered = req.code
    .split("\n")
    .map((line, i) => `${i + 1} | ${line}`)
    .join("\n");
  const list = (names: string[]) => names.join(", ") || "nenhum";
  return [
    `Nó: ${req.nodeName}`,
    `Tipo: ${KIND_LABEL[req.nodeKind]}`,
    `Chama: ${list(req.calls)}`,
    `Chamado por: ${list(req.calledBy)}`,
    ...(req.docstring
      ? [
          "Docstring (pode estar desatualizada; não use para resumir; compare com o código):",
          req.docstring.text,
        ]
      : []),
    "Código:",
    numbered,
  ].join("\n");
}

const shift = (lines: number[], start: number) =>
  lines.map((n) => n + start - 1);

/** What differs between the two parts: prompt, cache, docstring, sentence cap and the piece of the review kept. */
interface PartSpec<T> {
  part: ExplainPart;
  prompt: { text: string; version: string };
  cache: PartCache<T>;
  /** The suggestions judge the docstring; the summary never sees it (CFG-03, CFG-04). */
  withDocstring: boolean;
  maxSentences?: number;
  pick: (reviewed: Reviewed) => T;
  /** Relative lines in the cache → absolute lines in the response (CACHE-05). */
  toAbsolute: (result: T, start: number) => T;
}

function summarySpec(
  req: ExplainRequest,
  deps: ExplainDeps,
): PartSpec<Summary> {
  // A step gets its own prompt and at most 2 sentences (VID-28).
  const isStep = explainStyle(req.nodeKind) === "step";
  return {
    part: "summary",
    prompt: isStep ? deps.prompts.stepSummary : deps.prompts.summary,
    cache: deps.summaryCache,
    withDocstring: false,
    ...(isStep ? { maxSentences: STEP_SENTENCE_LIMIT } : {}),
    pick: ({ summary, sentences, inputs, outputs }) => ({
      summary,
      sentences,
      inputs,
      outputs,
    }),
    toAbsolute: (result, start) => {
      const claims = (list: Summary["inputs"]) =>
        list.map((c) => ({ ...c, lines: shift(c.lines, start) }));
      return {
        ...result,
        sentences: claims(result.sentences),
        inputs: claims(result.inputs),
        outputs: claims(result.outputs),
      };
    },
  };
}

function suggestionsSpec(deps: ExplainDeps): PartSpec<Suggestion[]> {
  return {
    part: "suggestions",
    prompt: deps.prompts.suggestions,
    cache: deps.suggestionsCache,
    withDocstring: true,
    pick: (reviewed) => reviewed.suggestions,
    toAbsolute: (result, start) =>
      result.map((s) => ({
        ...s,
        line: s.line + start - 1,
        lines: shift(s.lines, start),
      })),
  };
}

const sorted = (names: string[]) =>
  [...names].sort((a, b) => a.localeCompare(b));

/** Cache by node → review pipeline → cache, for one part; reports why a cached entry was replaced (C7). */
async function explainPart<T>(
  spec: PartSpec<T>,
  req: ExplainRequest,
  deps: ExplainDeps,
  options: ExplainOptions,
): Promise<ExplainResponse<T>> {
  const { llm } = deps;
  const { cache, prompt } = spec;
  // The prompt gets exactly what the fingerprint covers (L-004).
  const code = normalizeCode(req.code);
  const calls = sorted(req.calls);
  const calledBy = sorted(req.calledBy);
  const docstring = spec.withDocstring ? req.docstring : undefined;
  const fp = fingerprintOf(
    { code, calls, calledBy, docstring },
    { ...deps, prompt },
  );

  const prev = await cache.get(req.nodeId);
  if (prev && diffReasons(prev.fingerprint, fp).length === 0) {
    return {
      status: "ok",
      result: spec.toAbsolute(prev.result, req.range.start),
      fromCache: true,
      review: prev.review,
    };
  }
  if (options.cachedOnly) return { status: "not-cached" };
  if (!llm) return { status: "no-key" };

  const { docstring: _, ...withoutDocstring } = req;
  let outcome: ReviewOutcome;
  try {
    outcome = await reviewedDraft(
      {
        user: userMessage({
          ...(docstring ? { ...req, docstring } : withoutDocstring),
          code,
          calls,
          calledBy,
        }),
        code,
        neighbours: [...calls, ...calledBy],
        ...(docstring ? { docstringLine: docstring.line } : {}),
      },
      {
        ...deps,
        llm,
        part: spec.part,
        prompt,
        ...(spec.maxSentences === undefined
          ? {}
          : { maxSentences: spec.maxSentences }),
      },
    );
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (outcome.kind === "unfaithful") return { status: "unfaithful" };

  const result = spec.pick(outcome.result);
  try {
    await cache.set({
      schemaVersion: 4,
      nodeId: req.nodeId,
      fingerprint: fp,
      review: outcome.review,
      createdAt: new Date().toISOString(),
      result,
    });
  } catch (err) {
    console.error("explain: failed to write cache", err);
  }
  return {
    status: "ok",
    result: spec.toAbsolute(result, req.range.start),
    fromCache: false,
    review: outcome.review,
    ...(prev ? { update: diffReasons(prev.fingerprint, fp) } : {}),
  };
}

/** The summary, inputs and outputs of a node (CFG-01). */
export function summarizeNode(
  req: ExplainRequest,
  deps: ExplainDeps,
  options: ExplainOptions = {},
): Promise<SummaryResponse> {
  return explainPart(summarySpec(req, deps), req, deps, options);
}

/** The suggestions of a node, with the docstring verdict as the first one (CFG-02, CFG-03). */
export function suggestNode(
  req: ExplainRequest,
  deps: ExplainDeps,
  options: ExplainOptions = {},
): Promise<SuggestionsResponse> {
  return explainPart(suggestionsSpec(deps), req, deps, options);
}
