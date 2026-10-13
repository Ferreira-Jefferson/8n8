import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExplainRequest,
  type Explanation,
  sliceLines,
} from "@code2n8n/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSystemPrompt,
  createDiskCache,
  type ExplainCache,
  type ExplainDeps,
  explainNode,
  type LlmClient,
} from "../index";

type LlmRequest = Parameters<LlmClient["complete"]>[0];

function fakeLlm(answer: string | (() => never)) {
  const requests: LlmRequest[] = [];
  const llm: LlmClient = {
    async complete(req) {
      requests.push(req);
      return typeof answer === "string" ? answer : answer();
    },
  };
  return { llm, requests };
}

const SOURCE = [
  "SEGREDO_FORA = 1", // line 1, outside the node
  "def calcular_frete(peso):", // 2
  "    if peso > 30:", // 3
  "        return 50", // 4
  "    return 10", // 5
].join("\n");
const RANGE = { start: 2, end: 5 };
const CODE = sliceLines(SOURCE, RANGE);

const request = (overrides: Partial<ExplainRequest> = {}): ExplainRequest => ({
  nodeName: "calcular_frete",
  nodeKind: "function",
  code: CODE,
  range: RANGE,
  calls: ["buscar_tabela", "aplicar_taxa"],
  calledBy: ["main"],
  ...overrides,
});

// Lines relative to the node (1..4).
const answer: Explanation = {
  summary: "Calcula o frete a partir do peso.",
  inputs: ["peso"],
  outputs: ["valor do frete"],
  suggestions: [
    {
      command: "Valide `peso`.",
      reason: "Peso negativo.",
      line: 2,
      severity: "media",
    },
  ],
};
const ANSWER = JSON.stringify(answer);
const suggestionAt = (line: number) => ({
  command: "Valide `peso`.",
  reason: "Peso negativo.",
  line,
  severity: "media" as const,
});

const prompt = buildSystemPrompt("REGRAS PTS");
const MODEL = "~deepseek/deepseek-v4-flash-latest";

let dir: string;
let cache: ExplainCache;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "code2n8n-explain-"));
  cache = createDiskCache(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const deps = (
  llm: LlmClient | undefined,
  extra: Partial<ExplainDeps> = {},
): ExplainDeps => ({ llm, cache, model: MODEL, prompt, ...extra });

describe("explainNode", () => {
  it("makes one LLM call with the PTS system prompt and returns the explanation (CORE-16)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    const res = await explainNode(request(), deps(llm));
    expect(requests).toHaveLength(1);
    expect(requests[0]?.model).toBe(MODEL);
    expect(requests[0]?.messages[0]).toEqual({
      role: "system",
      content: prompt.text,
    });
    expect(res).toEqual({
      status: "ok",
      fromCache: false,
      explanation: { ...answer, suggestions: [suggestionAt(3)] },
    });
  });

  it("sends only the node name, kind, neighbour names and numbered code (CORE-17)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await explainNode(request(), deps(llm));
    const messages = requests[0]?.messages ?? [];
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("calcular_frete");
    expect(user).toContain("função");
    expect(user).toContain("Chama: buscar_tabela, aplicar_taxa");
    expect(user).toContain("Chamado por: main");
    expect(user).toContain("1 | def calcular_frete(peso):");
    expect(user).toContain("4 |     return 10");
    expect(user).not.toContain("5 |");
    for (const m of messages) expect(m.content).not.toContain("SEGREDO_FORA");
  });

  it("serves the second opening from cache without calling the LLM (CORE-18)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    const first = await explainNode(request(), deps(llm));
    const second = await explainNode(request(), deps(llm));
    expect(requests).toHaveLength(1);
    expect(second).toEqual({ ...first, fromCache: true });
  });

  it("calls the LLM again for another model or another prompt version (CORE-18)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await explainNode(request(), deps(llm));
    await explainNode(request(), deps(llm, { model: "openai/gpt-x" }));
    await explainNode(
      request(),
      deps(llm, { prompt: buildSystemPrompt("OUTRAS REGRAS") }),
    );
    expect(requests).toHaveLength(3);
  });

  it("hits the cache for the same code at another position and returns absolute lines", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await explainNode(request(), deps(llm));
    const moved = await explainNode(
      request({ range: { start: 11, end: 14 } }),
      deps(llm),
    );
    expect(requests).toHaveLength(1);
    expect(moved).toEqual({
      status: "ok",
      fromCache: true,
      explanation: { ...answer, suggestions: [suggestionAt(12)] },
    });
  });

  it("returns no-key without llm and without cache (CORE-19)", async () => {
    expect(await explainNode(request(), deps(undefined))).toEqual({
      status: "no-key",
    });
  });

  it("returns the cached ok without llm when the cache has the entry (CORE-19)", async () => {
    const { llm } = fakeLlm(ANSWER);
    const first = await explainNode(request(), deps(llm));
    const res = await explainNode(request(), deps(undefined));
    expect(res).toEqual({ ...first, fromCache: true });
  });

  it("returns error and writes nothing when the LLM throws (CORE-20)", async () => {
    const { llm } = fakeLlm(() => {
      throw new Error("rede caiu");
    });
    const res = await explainNode(request(), deps(llm));
    expect(res).toEqual({ status: "error", message: "rede caiu" });
    expect(await readdir(dir)).toEqual([]);
  });

  it("returns error when the LLM answers invalid JSON (CORE-20)", async () => {
    const { llm } = fakeLlm("isto não é JSON");
    const res = await explainNode(request(), deps(llm));
    expect(res.status).toBe("error");
    expect(await readdir(dir)).toEqual([]);
  });

  it("drops suggestions outside the node from the response and the cache (CORE-22)", async () => {
    const raw = JSON.stringify({
      ...answer,
      suggestions: [0, 2, 5, 99].map(suggestionAt),
    });
    const { llm } = fakeLlm(raw);
    const res = await explainNode(request(), deps(llm));
    expect(res).toEqual({
      status: "ok",
      fromCache: false,
      explanation: { ...answer, suggestions: [suggestionAt(3)] },
    });
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    const stored = JSON.parse(
      await readFile(join(dir, files[0] ?? ""), "utf8"),
    );
    expect(stored.result.suggestions).toEqual([suggestionAt(2)]);
  });

  it("uses json 'prompt' for google/* models and 'native' for others", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await explainNode(request(), deps(llm, { model: "google/gemini-x" }));
    await explainNode(request(), deps(llm, { model: "openai/gpt-x" }));
    expect(requests.map((r) => r.json)).toEqual(["prompt", "native"]);
  });

  it("still returns ok when writing the cache fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: ExplainCache = {
      get: async () => undefined,
      set: async () => {
        throw new Error("disco cheio");
      },
    };
    const { llm } = fakeLlm(ANSWER);
    const res = await explainNode(request(), deps(llm, { cache: failing }));
    expect(res).toEqual({
      status: "ok",
      fromCache: false,
      explanation: { ...answer, suggestions: [suggestionAt(3)] },
    });
    spy.mockRestore();
  });
});
