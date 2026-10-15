import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExplainRequest, type LlmClient, sliceLines } from "@8n8/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildReviewerPrompt,
  buildSystemPrompt,
  createDiskCache,
  type ExplainCache,
  type ExplainDeps,
  explainNode,
} from "../index";
import { buildStepPrompt } from "../prompt";
import { PY } from "./py";

type LlmRequest = Parameters<LlmClient["complete"]>[0];

const prompt = buildSystemPrompt("REGRAS PTS", PY);
const stepPrompt = buildStepPrompt("REGRAS PTS", PY);
const reviewer = buildReviewerPrompt(PY);
const MODEL = "~deepseek/deepseek-v4-flash-latest";

/** Relative evidence the fake reviewer gives by claim kind. */
const EVIDENCE: Record<string, number[]> = {
  s: [1],
  i: [1],
  o: [3, 4],
  g: [2],
};

/**
 * Fake LLM: a reviewer request (system = reviewer prompt) supports every
 * `- <id>: <text>` line with EVIDENCE; a draft request gets `answer`.
 */
function fakeLlm(answer: string | (() => never)) {
  const requests: LlmRequest[] = [];
  const llm: LlmClient = {
    async complete(req) {
      requests.push(req);
      if (req.messages[0]?.content === reviewer.text) {
        const user = req.messages[1]?.content ?? "";
        const verdicts = [...user.matchAll(/^- (\w+): /gm)].map(([, id]) => ({
          id,
          supported: true,
          evidence: EVIDENCE[(id as string)[0] as string],
        }));
        return JSON.stringify({ verdicts });
      }
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
  nodeId: "fn:calcular_frete",
  language: "python",
  nodeName: "calcular_frete",
  nodeKind: "function",
  code: CODE,
  range: RANGE,
  calls: ["buscar_tabela", "aplicar_taxa"],
  calledBy: ["main"],
  ...overrides,
});

const SUMMARY = "Calcula o frete a partir do peso.";
const suggestionAt = (line: number) => ({
  command: "Valide `peso`.",
  reason: "Peso negativo.",
  line,
  severity: "media" as const,
});
// The draft as the LLM writes it; lines relative to the node (1..4).
const draft = {
  summary: SUMMARY,
  inputs: ["peso"],
  outputs: ["valor do frete"],
  suggestions: [suggestionAt(2)],
};
const ANSWER = JSON.stringify(draft);

/** The reviewed explanation with every line shifted to a node starting at `start`. */
const explained = (start: number) => {
  const at = (n: number) => n + start - 1;
  return {
    summary: SUMMARY,
    sentences: [{ id: "s1", text: SUMMARY, lines: [at(1)] }],
    inputs: [{ id: "i1", text: "peso", lines: [at(1)] }],
    outputs: [{ id: "o1", text: "valor do frete", lines: [at(3), at(4)] }],
    suggestions: [{ id: "g1", ...suggestionAt(at(2)), lines: [at(2)] }],
  };
};

let dir: string;
let cache: ExplainCache;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "8n8-explain-"));
  cache = createDiskCache(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const nodesDir = () => join(dir, "nodes");
const nodeFile = (nodeId: string) =>
  join(nodesDir(), `${createHash("sha256").update(nodeId).digest("hex")}.json`);

const deps = (
  llm: LlmClient | undefined,
  extra: Partial<ExplainDeps> = {},
): ExplainDeps => ({
  llm,
  cache,
  provider: "openrouter",
  model: MODEL,
  reviewModel: MODEL,
  prompt,
  stepPrompt,
  reviewer,
  ...extra,
});

describe("explainNode", () => {
  it("makes one draft with the PTS system prompt and one review, and returns the explanation (FID-01, FID-05)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    const res = await explainNode(request(), deps(llm));
    expect(requests).toHaveLength(2);
    expect(requests[0]?.model).toBe(MODEL);
    expect(requests[0]?.messages[0]).toEqual({
      role: "system",
      content: prompt.text,
    });
    expect(requests[1]?.messages[0]).toEqual({
      role: "system",
      content: reviewer.text,
    });
    expect(res).toEqual({
      status: "ok",
      fromCache: false,
      review: "full",
      explanation: explained(2),
    });
  });

  it("sends only the node name, kind, sorted neighbour names and numbered code (CORE-17, L-004)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await explainNode(request(), deps(llm));
    const messages = requests[0]?.messages ?? [];
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("calcular_frete");
    expect(user).toContain("função");
    expect(user).toContain("Chama: aplicar_taxa, buscar_tabela");
    expect(user).toContain("Chamado por: main");
    expect(user).toContain("1 | def calcular_frete(peso):");
    expect(user).toContain("4 |     return 10");
    expect(user).not.toContain("5 |");
    for (const r of requests) {
      for (const m of r.messages)
        expect(m.content).not.toContain("SEGREDO_FORA");
    }
  });

  it("serves the second opening from cache with the stored review and no call (CACHE-02)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    const first = await explainNode(request(), deps(llm));
    const second = await explainNode(request(), deps(llm));
    expect(requests).toHaveLength(2);
    expect(second).toEqual({ ...first, fromCache: true });
  });

  it("serves a cut result from cache with review 'cut' and zero calls (CACHE-02)", async () => {
    const raw = JSON.stringify({ ...draft, summary: `${SUMMARY} Custa 7 kg.` });
    const { llm, requests } = fakeLlm(raw);
    const first = await explainNode(request(), deps(llm));
    expect(first).toMatchObject({ status: "ok", review: "cut" });
    const calls = requests.length;
    const second = await explainNode(request(), deps(llm));
    expect(requests).toHaveLength(calls);
    expect(second).toEqual({ ...first, fromCache: true, review: "cut" });
  });

  it("regenerates with update model-or-prompt for another model or another prompt version (CACHE-03, CACHE-04)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await explainNode(request(), deps(llm));
    const byModel = await explainNode(
      request(),
      deps(llm, { model: "openai/gpt-x" }),
    );
    const byPrompt = await explainNode(
      request(),
      deps(llm, {
        model: "openai/gpt-x",
        prompt: buildSystemPrompt("OUTRAS REGRAS", PY),
      }),
    );
    expect(requests).toHaveLength(6);
    expect(byModel).toMatchObject({
      fromCache: false,
      update: ["model-or-prompt"],
    });
    expect(byPrompt).toMatchObject({
      fromCache: false,
      update: ["model-or-prompt"],
    });
  });

  it("regenerates with update model-or-prompt when the reviewer model changes (CACHE-04, FID-15)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await explainNode(request(), deps(llm));
    const res = await explainNode(request(), deps(llm, { reviewModel: "r/x" }));
    expect(requests).toHaveLength(4);
    expect(requests[3]?.model).toBe("r/x");
    expect(res).toEqual({
      status: "ok",
      fromCache: false,
      review: "full",
      explanation: explained(2),
      update: ["model-or-prompt"],
    });
  });

  it("regenerates with update neighbours when a neighbour is renamed, and replaces the entry (CACHE-03, CACHE-04)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await explainNode(request(), deps(llm));
    const renamed = request({ calls: ["buscar_tabela", "aplicar_imposto"] });
    const res = await explainNode(renamed, deps(llm));
    expect(requests).toHaveLength(4);
    expect(res).toMatchObject({ fromCache: false, update: ["neighbours"] });
    expect(await readdir(nodesDir())).toHaveLength(1);
    const again = await explainNode(renamed, deps(llm));
    expect(requests).toHaveLength(4);
    expect(again).toMatchObject({ fromCache: true });
    expect("update" in again).toBe(false);
  });

  it("regenerates with update code when the code changes (CACHE-03, CACHE-04)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await explainNode(request(), deps(llm));
    const res = await explainNode(
      request({ code: CODE.replace("return 10", "return 12") }),
      deps(llm),
    );
    expect(requests).toHaveLength(4);
    expect(res).toMatchObject({ fromCache: false, update: ["code"] });
  });

  it("hits the cache for the same code at another position and shifts every line (CACHE-05)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await explainNode(request(), deps(llm));
    const moved = await explainNode(
      request({ range: { start: 11, end: 14 } }),
      deps(llm),
    );
    expect(requests).toHaveLength(2);
    expect(moved).toEqual({
      status: "ok",
      fromCache: true,
      review: "full",
      explanation: explained(11),
    });
  });

  it("serves the same code after 3 blank lines from cache with every line +3 and no update (Independent Test P2)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await explainNode(request(), deps(llm));
    const source = `\n\n\n${SOURCE}`;
    const range = { start: RANGE.start + 3, end: RANGE.end + 3 };
    const res = await explainNode(
      request({ code: sliceLines(source, range), range }),
      deps(llm),
    );
    expect(requests).toHaveLength(2);
    expect(res).toEqual({
      status: "ok",
      fromCache: true,
      review: "full",
      explanation: explained(5),
    });
    expect("update" in res).toBe(false);
  });

  it("serves code that differs only by CRLF or trailing spaces from cache (CACHE-01)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await explainNode(request(), deps(llm));
    const crlf = await explainNode(
      request({ code: CODE.replace(/\n/g, "\r\n") }),
      deps(llm),
    );
    const trailing = await explainNode(
      request({ code: CODE.replace(/\n/g, " \t\n") }),
      deps(llm),
    );
    expect(requests).toHaveLength(2);
    expect(crlf).toMatchObject({ fromCache: true });
    expect(trailing).toMatchObject({ fromCache: true });
  });

  it("regenerates over a v1 entry without update (CACHE-07)", async () => {
    await mkdir(nodesDir(), { recursive: true });
    await writeFile(
      nodeFile("fn:calcular_frete"),
      JSON.stringify({ schemaVersion: 1, key: "k", result: draft }),
      "utf8",
    );
    const { llm, requests } = fakeLlm(ANSWER);
    const res = await explainNode(request(), deps(llm));
    expect(requests).toHaveLength(2);
    expect(res).toEqual({
      status: "ok",
      fromCache: false,
      review: "full",
      explanation: explained(2),
    });
    const stored = JSON.parse(
      await readFile(nodeFile("fn:calcular_frete"), "utf8"),
    );
    expect(stored.schemaVersion).toBe(3);
  });

  it("regenerates over a corrupted entry without update and overwrites it (CACHE-07)", async () => {
    await mkdir(nodesDir(), { recursive: true });
    await writeFile(nodeFile("fn:calcular_frete"), "{ corrompido", "utf8");
    const { llm, requests } = fakeLlm(ANSWER);
    const res = await explainNode(request(), deps(llm));
    expect(res).toEqual({
      status: "ok",
      fromCache: false,
      review: "full",
      explanation: explained(2),
    });
    const again = await explainNode(request(), deps(llm));
    expect(requests).toHaveLength(2);
    expect(again).toMatchObject({ fromCache: true });
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

  it("returns unfaithful and writes nothing when no summary sentence survives (FID-01, FID-10)", async () => {
    const { llm, requests } = fakeLlm(
      JSON.stringify({ ...draft, summary: "Custa 7 kg." }),
    );
    const res = await explainNode(request(), deps(llm));
    expect(res).toEqual({ status: "unfaithful" });
    expect(requests).toHaveLength(6);
    expect(await readdir(dir)).toEqual([]);
  });

  it("stores only the reviewed result, with relative lines (FID-01)", async () => {
    const raw = JSON.stringify({ ...draft, summary: `${SUMMARY} Custa 7 kg.` });
    const { llm } = fakeLlm(raw);
    await explainNode(request(), deps(llm));
    const stored = JSON.parse(
      await readFile(nodeFile("fn:calcular_frete"), "utf8"),
    );
    expect(stored.review).toBe("cut");
    expect(stored.result).toEqual(explained(1));
  });

  it("drops suggestions outside the node from the response and the cache (CORE-22)", async () => {
    const raw = JSON.stringify({
      ...draft,
      suggestions: [0, 2, 5, 99].map(suggestionAt),
    });
    const { llm } = fakeLlm(raw);
    const res = await explainNode(request(), deps(llm));
    expect(res).toEqual({
      status: "ok",
      fromCache: false,
      review: "full",
      explanation: explained(2),
    });
    const files = await readdir(nodesDir());
    expect(files).toHaveLength(1);
    const stored = JSON.parse(
      await readFile(join(nodesDir(), files[0] ?? ""), "utf8"),
    );
    expect(stored.result.suggestions).toEqual([
      { id: "g1", ...suggestionAt(2), lines: [2] },
    ]);
  });

  it("asks for json 'native' whatever the model: the client's profile decides the rest", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await explainNode(
      request(),
      deps(llm, { model: "google/gemini-x", reviewModel: "google/gemini-x" }),
    );
    await explainNode(
      request(),
      deps(llm, { model: "openai/gpt-x", reviewModel: "openai/gpt-x" }),
    );
    expect(requests.map((r) => r.json)).toEqual([
      "native",
      "native",
      "native",
      "native",
    ]);
  });

  it("regenerates, with the reason model-or-prompt, when the provider changed (CACHE-04)", async () => {
    const first = fakeLlm(ANSWER);
    await explainNode(request(), deps(first.llm));
    const same = fakeLlm(ANSWER);
    expect(await explainNode(request(), deps(same.llm))).toMatchObject({
      fromCache: true,
    });
    expect(same.requests).toHaveLength(0);

    const other = fakeLlm(ANSWER);
    const res = await explainNode(
      request(),
      deps(other.llm, { provider: "openai-compatible" }),
    );
    expect(other.requests).toHaveLength(2);
    expect(res).toMatchObject({
      fromCache: false,
      update: ["model-or-prompt"],
    });
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
      review: "full",
      explanation: explained(2),
    });
    spy.mockRestore();
  });
});

describe("explainNode for a step (VID-28)", () => {
  const step = (overrides: Partial<ExplainRequest> = {}) =>
    request({
      nodeId: "fn:calcular_frete/s0",
      nodeName: "requests.get",
      nodeKind: "external",
      calls: [],
      calledBy: [],
      ...overrides,
    });

  it("uses the step prompt and the kind label for a step, and the full prompt for a function", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await explainNode(step(), deps(llm));
    expect(requests[0]?.messages[0]).toEqual({
      role: "system",
      content: stepPrompt.text,
    });
    expect(requests[0]?.messages[1]?.content).toContain(
      "Tipo: chamada externa",
    );
    await explainNode(request(), deps(llm));
    expect(requests[2]?.messages[0]).toEqual({
      role: "system",
      content: prompt.text,
    });
    expect(requests[2]?.messages[1]?.content).toContain("Tipo: função");
  });

  it("keeps at most 2 sentences of a 3-sentence step draft", async () => {
    const raw = JSON.stringify({
      ...draft,
      summary: `${SUMMARY} Lê \`peso\`. Devolve um valor.`,
    });
    const { llm } = fakeLlm(raw);
    const res = await explainNode(step(), deps(llm));
    expect(res).toMatchObject({
      status: "ok",
      review: "full",
      explanation: {
        summary: `${SUMMARY} Lê \`peso\`.`,
        sentences: [
          { id: "s1", text: SUMMARY, lines: [2] },
          { id: "s2", text: "Lê `peso`.", lines: [2] },
        ],
      },
    });
  });

  it("keeps all 3 sentences of a function draft", async () => {
    const raw = JSON.stringify({
      ...draft,
      summary: `${SUMMARY} Lê \`peso\`. Devolve um valor.`,
    });
    const { llm } = fakeLlm(raw);
    const res = await explainNode(request(), deps(llm));
    expect(res.status === "ok" && res.explanation.sentences).toHaveLength(3);
  });

  it("caches a step with the step prompt version, reopens with 0 calls and updates on a new step prompt", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await explainNode(step(), deps(llm));
    const stored = JSON.parse(
      await readFile(nodeFile("fn:calcular_frete/s0"), "utf8"),
    );
    expect(stored.fingerprint.promptVersion).toBe(stepPrompt.version);
    expect(stepPrompt.version).not.toBe(prompt.version);

    const again = await explainNode(step(), deps(llm));
    expect(requests).toHaveLength(2);
    expect(again).toMatchObject({ status: "ok", fromCache: true });

    const res = await explainNode(
      step(),
      deps(llm, { stepPrompt: buildStepPrompt("OUTRAS REGRAS", PY) }),
    );
    expect(requests).toHaveLength(4);
    expect(res).toMatchObject({
      fromCache: false,
      update: ["model-or-prompt"],
    });
  });
});

describe("docstring judged against the code", () => {
  const DOC = { text: "Calcula o imposto.", line: 2 };
  const reflects = (value: boolean) => ({
    ...draft,
    suggestions: [],
    docstring: {
      reflects: value,
      reason: "Fala de imposto, mas `peso` só define o frete.",
    },
  });
  const userOf = (requests: LlmRequest[]) =>
    requests[0]?.messages[1]?.content ?? "";

  it("adds the Docstring block before the numbered code only when the request has one", async () => {
    const withDoc = fakeLlm(JSON.stringify(reflects(true)));
    await explainNode(request({ docstring: DOC }), deps(withDoc.llm));
    const user = userOf(withDoc.requests);
    expect(user).toContain(
      "Docstring (pode estar desatualizada; não use para resumir; compare com o código):\nCalcula o imposto.\nCódigo:",
    );

    const without = fakeLlm(ANSWER);
    await explainNode(request(), deps(without.llm));
    expect(userOf(without.requests)).not.toContain("Docstring");
  });

  it("adds a first suggestion at the docstring line when reflects is false", async () => {
    const { llm } = fakeLlm(JSON.stringify(reflects(false)));
    const res = await explainNode(request({ docstring: DOC }), deps(llm));
    expect(res.status === "ok" && res.explanation.suggestions).toEqual([
      {
        id: "g1",
        command:
          "Atualize a docstring: Fala de imposto, mas `peso` só define o frete",
        reason: "A docstring não reflete o que o código faz.",
        line: 3,
        severity: "media",
        lines: [3],
      },
    ]);
  });

  it("adds nothing when reflects is true or missing", async () => {
    for (const answer of [reflects(true), draft]) {
      const { llm } = fakeLlm(JSON.stringify({ ...answer, suggestions: [] }));
      const res = await explainNode(
        request({ docstring: DOC, nodeId: "fn:x" }),
        deps(llm),
      );
      expect(res.status === "ok" && res.explanation.suggestions).toEqual([]);
    }
  });

  it("adds nothing when the request has no docstring, even if the model answers the field", async () => {
    const { llm } = fakeLlm(JSON.stringify(reflects(false)));
    const res = await explainNode(request(), deps(llm));
    expect(res.status === "ok" && res.explanation.suggestions).toEqual([]);
  });

  it("keeps at most 5 suggestions, dropping the last other one", async () => {
    const others = [1, 2, 3, 4, 5].map((n) => ({
      ...suggestionAt(2),
      command: `Valide \`peso\` ${"a".repeat(n)}.`,
    }));
    const { llm } = fakeLlm(
      JSON.stringify({ ...reflects(false), suggestions: others }),
    );
    const res = await explainNode(request({ docstring: DOC }), deps(llm));
    const list = res.status === "ok" ? res.explanation.suggestions : [];
    expect(list).toHaveLength(5);
    expect(list[0]?.command).toMatch(/^Atualize a docstring: /);
    expect(list[4]?.command).toBe(others[3]?.command);
  });
});
