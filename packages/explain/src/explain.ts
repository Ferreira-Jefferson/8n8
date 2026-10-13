import { createHash } from "node:crypto";
import type {
  ExplainRequest,
  ExplainResponse,
  Explanation,
} from "@code2n8n/model";
import type { ExplainCache } from "./cache";
import type { LlmClient } from "./openrouter";
import { parseExplanation } from "./schema";

export interface ExplainDeps {
  /** Absent when OPENROUTER_API_KEY is not set (CORE-19). */
  llm?: LlmClient | undefined;
  cache: ExplainCache;
  model: string;
  prompt: { text: string; version: string };
}

const KIND_LABEL = { function: "função", class: "classe" } as const;

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
    "Código:",
    numbered,
  ].join("\n");
}

function toAbsolute(result: Explanation, start: number): Explanation {
  return {
    ...result,
    suggestions: result.suggestions.map((s) => ({
      ...s,
      line: s.line + start - 1,
    })),
  };
}

/** One cached LLM call per node: key on [code, model, promptVersion]; relative lines in cache (CORE-16..22). */
export async function explainNode(
  req: ExplainRequest,
  deps: ExplainDeps,
): Promise<ExplainResponse> {
  const { llm, cache, model, prompt } = deps;
  const key = createHash("sha256")
    .update(JSON.stringify([req.code, model, prompt.version]))
    .digest("hex");

  const cached = await cache.get(key);
  if (cached) {
    return {
      status: "ok",
      explanation: toAbsolute(cached.result, req.range.start),
      fromCache: true,
    };
  }
  if (!llm) return { status: "no-key" };

  let result: Explanation;
  try {
    const raw = await llm.complete({
      model,
      messages: [
        { role: "system", content: prompt.text },
        { role: "user", content: userMessage(req) },
      ],
      json: model.startsWith("google/") ? "prompt" : "native",
    });
    result = parseExplanation(raw, req.code.split("\n").length);
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    await cache.set({
      schemaVersion: 1,
      key,
      model,
      promptVersion: prompt.version,
      createdAt: new Date().toISOString(),
      result,
    });
  } catch (err) {
    console.error("explain: failed to write cache", err);
  }
  return {
    status: "ok",
    explanation: toAbsolute(result, req.range.start),
    fromCache: false,
  };
}
