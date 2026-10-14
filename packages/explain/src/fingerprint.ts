import { createHash } from "node:crypto";
import type { ExplainRequest, UpdateReason } from "@code2n8n/model";

/** Separate components so a change can be reported by reason (CACHE-01, CACHE-04). */
export interface Fingerprint {
  /** sha256 hex of the normalized code */
  code: string;
  /** sha256 hex of JSON {calls, calledBy}, deduplicated and sorted */
  neighbours: string;
  /** Id of the LLM provider: the same model name on two providers may answer differently. */
  provider: string;
  model: string;
  reviewModel: string;
  promptVersion: string;
  reviewerVersion: string;
}

export interface FingerprintDeps {
  provider: string;
  model: string;
  reviewModel: string;
  prompt: { version: string };
  reviewer: { version: string };
}

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

/** CRLF and CR become LF; trailing spaces and tabs go; the line count stays (C5). */
export function normalizeCode(code: string): string {
  return code
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
}

const sortedUnique = (names: string[]) =>
  [...new Set(names)].sort((a, b) => a.localeCompare(b));

/** Hash of both neighbour lists, each deduplicated and sorted, kept apart (C5). */
export function neighbourKey(calls: string[], calledBy: string[]): string {
  return sha256(
    JSON.stringify({
      calls: sortedUnique(calls),
      calledBy: sortedUnique(calledBy),
    }),
  );
}

export function fingerprintOf(
  req: Pick<ExplainRequest, "code" | "calls" | "calledBy"> & {
    docstring?: ExplainRequest["docstring"] | undefined;
  },
  deps: FingerprintDeps,
): Fingerprint {
  return {
    // The code is masked, so the docstring joins the hash: editing it must invalidate.
    code: sha256(
      req.docstring
        ? `${normalizeCode(req.code)}
${normalizeCode(req.docstring.text)}`
        : normalizeCode(req.code),
    ),
    neighbours: neighbourKey(req.calls, req.calledBy),
    provider: deps.provider,
    model: deps.model,
    reviewModel: deps.reviewModel,
    promptVersion: deps.prompt.version,
    reviewerVersion: deps.reviewer.version,
  };
}

/** Reasons in fixed order: code, neighbours, model-or-prompt (CACHE-04). */
export function diffReasons(
  old: Fingerprint,
  now: Fingerprint,
): UpdateReason[] {
  const reasons: UpdateReason[] = [];
  if (old.code !== now.code) reasons.push("code");
  if (old.neighbours !== now.neighbours) reasons.push("neighbours");
  if (
    old.provider !== now.provider ||
    old.model !== now.model ||
    old.reviewModel !== now.reviewModel ||
    old.promptVersion !== now.promptVersion ||
    old.reviewerVersion !== now.reviewerVersion
  ) {
    reasons.push("model-or-prompt");
  }
  return reasons;
}
