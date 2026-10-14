import {
  type ExplainKind,
  type ExplainRequest,
  type ExplainResponse,
  type Explanation,
  explainStyle,
  STEP_SENTENCE_LIMIT,
} from "@code2n8n/model";
import type { ExplainCache } from "./cache";
import { diffReasons, fingerprintOf, normalizeCode } from "./fingerprint";
import type { LlmClient } from "./openrouter";
import { type ReviewOutcome, reviewedDraft } from "./review";

export interface ExplainDeps {
  /** Absent when OPENROUTER_API_KEY is not set (CORE-19). */
  llm?: LlmClient | undefined;
  cache: ExplainCache;
  model: string;
  /** Model of the reviewer (FID-15). */
  reviewModel: string;
  prompt: { text: string; version: string };
  /** Prompt for steps inside a function (VID-28). */
  stepPrompt: { text: string; version: string };
  reviewer: { text: string; version: string };
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

/** Relative lines in the cache → absolute lines in the response, for every claim and suggestion (CACHE-05). */
function toAbsolute(result: Explanation, start: number): Explanation {
  const shift = (lines: number[]) => lines.map((n) => n + start - 1);
  const claims = (list: Explanation["inputs"]) =>
    list.map((c) => ({ ...c, lines: shift(c.lines) }));
  return {
    ...result,
    sentences: claims(result.sentences),
    inputs: claims(result.inputs),
    outputs: claims(result.outputs),
    suggestions: result.suggestions.map((s) => ({
      ...s,
      line: s.line + start - 1,
      lines: shift(s.lines),
    })),
  };
}

const sorted = (names: string[]) =>
  [...names].sort((a, b) => a.localeCompare(b));

/** Cache by node → review pipeline → cache; reports why a cached entry was replaced (C7). */
export async function explainNode(
  req: ExplainRequest,
  deps: ExplainDeps,
): Promise<ExplainResponse> {
  const { llm, cache } = deps;
  // A step gets its own prompt and at most 2 sentences (VID-28).
  const isStep = explainStyle(req.nodeKind) === "step";
  const prompt = isStep ? deps.stepPrompt : deps.prompt;
  const maxSentences = isStep ? STEP_SENTENCE_LIMIT : undefined;
  // The prompt gets exactly what the fingerprint covers (L-004).
  const code = normalizeCode(req.code);
  const calls = sorted(req.calls);
  const calledBy = sorted(req.calledBy);
  const fp = fingerprintOf({ code, calls, calledBy }, { ...deps, prompt });

  const prev = await cache.get(req.nodeId);
  if (prev && diffReasons(prev.fingerprint, fp).length === 0) {
    return {
      status: "ok",
      explanation: toAbsolute(prev.result, req.range.start),
      fromCache: true,
      review: prev.review,
    };
  }
  if (!llm) return { status: "no-key" };

  let outcome: ReviewOutcome;
  try {
    outcome = await reviewedDraft(
      {
        user: userMessage({ ...req, code, calls, calledBy }),
        code,
        neighbours: [...calls, ...calledBy],
        ...(req.docstring ? { docstringLine: req.docstring.line } : {}),
      },
      {
        ...deps,
        llm,
        prompt,
        ...(maxSentences === undefined ? {} : { maxSentences }),
      },
    );
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (outcome.kind === "unfaithful") return { status: "unfaithful" };

  try {
    await cache.set({
      schemaVersion: 2,
      nodeId: req.nodeId,
      fingerprint: fp,
      review: outcome.review,
      createdAt: new Date().toISOString(),
      result: outcome.result,
    });
  } catch (err) {
    console.error("explain: failed to write cache", err);
  }
  return {
    status: "ok",
    explanation: toAbsolute(outcome.result, req.range.start),
    fromCache: false,
    review: outcome.review,
    ...(prev ? { update: diffReasons(prev.fingerprint, fp) } : {}),
  };
}
