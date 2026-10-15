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
import {
  type ExplainRequest,
  type LlmClient,
  type Summary,
  sliceLines,
} from "@8n8/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildReviewerPrompt,
  buildStepSummaryPrompt,
  buildSuggestionsPrompt,
  buildSummaryPrompt,
  createSuggestionsCache,
  createSummaryCache,
  type ExplainDeps,
  type PartCache,
  suggestNode,
  summarizeNode,
} from "../index";
import { PY } from "./py";

type LlmRequest = Parameters<LlmClient["complete"]>[0];

const prompts = {
  summary: buildSummaryPrompt("REGRAS PTS", PY),
  stepSummary: buildStepSummaryPrompt("REGRAS PTS", PY),
  suggestions: buildSuggestionsPrompt("REGRAS PTS", PY),
};
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
 * `- <id>: <text>` line with EVIDENCE, unless `reject` names the id; a draft
 * request gets `answer`, whatever the part.
 */
function fakeLlm(
  answer: string | (() => never),
  reject: (id: string) => boolean = () => false,
) {
  const requests: LlmRequest[] = [];
  const llm: LlmClient = {
    async complete(req) {
      requests.push(req);
      if (req.messages[0]?.content === reviewer.text) {
        const user = req.messages[1]?.content ?? "";
        const verdicts = [...user.matchAll(/^- (\w+): /gm)].map(([, id]) =>
          reject(id as string)
            ? { id, supported: false, evidence: [], problem: "não" }
            : {
                id,
                supported: true,
                evidence: EVIDENCE[(id as string)[0] as string],
              },
        );
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
// The draft as the LLM writes it; lines relative to the node (1..4). The fake
// answers both parts with it: each parser reads only its own fields.
const draft = {
  summary: SUMMARY,
  inputs: ["peso"],
  outputs: ["valor do frete"],
  suggestions: [suggestionAt(2)],
};
const ANSWER = JSON.stringify(draft);

/** The reviewed summary with every line shifted to a node starting at `start`. */
const summarized = (start: number): Summary => {
  const at = (n: number) => n + start - 1;
  return {
    summary: SUMMARY,
    sentences: [{ id: "s1", text: SUMMARY, lines: [at(1)] }],
    inputs: [{ id: "i1", text: "peso", lines: [at(1)] }],
    outputs: [{ id: "o1", text: "valor do frete", lines: [at(3), at(4)] }],
  };
};

/** The reviewed suggestions with every line shifted to a node starting at `start`. */
const suggested = (start: number) => {
  const at = (n: number) => n + start - 1;
  return [{ id: "g1", ...suggestionAt(at(2)), lines: [at(2)] }];
};

let dir: string;
let summaryCache: PartCache<Summary>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "8n8-explain-"));
  summaryCache = createSummaryCache(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const fileIn = (folder: string, nodeId: string) =>
  join(
    dir,
    folder,
    `${createHash("sha256").update(nodeId).digest("hex")}.json`,
  );
const nodesDir = () => join(dir, "nodes");
const nodeFile = (nodeId: string) => fileIn("nodes", nodeId);

const deps = (
  llm: LlmClient | undefined,
  extra: Partial<ExplainDeps> = {},
): ExplainDeps => ({
  llm,
  summaryCache,
  suggestionsCache: createSuggestionsCache(dir),
  provider: "openrouter",
  model: MODEL,
  reviewModel: MODEL,
  prompts,
  reviewer,
  ...extra,
});

const user = (r: LlmRequest | undefined) =>
  r?.messages.find((m) => m.role === "user")?.content ?? "";

describe("summarizeNode (CFG-01)", () => {
  it("makes one draft with the summary prompt and one review, and returns only the summary (FID-01, FID-05)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    const res = await summarizeNode(request(), deps(llm));
    expect(requests).toHaveLength(2);
    expect(requests[0]?.model).toBe(MODEL);
    expect(requests[0]?.messages[0]).toEqual({
      role: "system",
      content: prompts.summary.text,
    });
    expect(requests[1]?.messages[0]).toEqual({
      role: "system",
      content: reviewer.text,
    });
    // The suggestion in the answer never reaches the reviewer.
    expect(user(requests[1])).not.toContain("g1");
    expect(res).toEqual({
      status: "ok",
      fromCache: false,
      review: "full",
      result: summarized(2),
    });
  });

  it("sends only the node name, kind, sorted neighbour names and numbered code (CORE-17, L-004)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await summarizeNode(request(), deps(llm));
    const text = user(requests[0]);
    expect(text).toContain("calcular_frete");
    expect(text).toContain("função");
    expect(text).toContain("Chama: aplicar_taxa, buscar_tabela");
    expect(text).toContain("Chamado por: main");
    expect(text).toContain("1 | def calcular_frete(peso):");
    expect(text).toContain("4 |     return 10");
    expect(text).not.toContain("5 |");
    for (const r of requests) {
      for (const m of r.messages)
        expect(m.content).not.toContain("SEGREDO_FORA");
    }
  });

  it("serves the second opening from cache with the stored review and no call (CACHE-02)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    const first = await summarizeNode(request(), deps(llm));
    const second = await summarizeNode(request(), deps(llm));
    expect(requests).toHaveLength(2);
    expect(second).toEqual({ ...first, fromCache: true });
  });

  it("serves a cut result from cache with review 'cut' and zero calls (CACHE-02)", async () => {
    const raw = JSON.stringify({ ...draft, summary: `${SUMMARY} Custa 7 kg.` });
    const { llm, requests } = fakeLlm(raw);
    const first = await summarizeNode(request(), deps(llm));
    expect(first).toMatchObject({ status: "ok", review: "cut" });
    const calls = requests.length;
    const second = await summarizeNode(request(), deps(llm));
    expect(requests).toHaveLength(calls);
    expect(second).toEqual({ ...first, fromCache: true, review: "cut" });
  });

  it("regenerates with update model-or-prompt for another model or another prompt version (CACHE-03, CACHE-04)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await summarizeNode(request(), deps(llm));
    const byModel = await summarizeNode(
      request(),
      deps(llm, { model: "openai/gpt-x" }),
    );
    const byPrompt = await summarizeNode(
      request(),
      deps(llm, {
        model: "openai/gpt-x",
        prompts: {
          ...prompts,
          summary: buildSummaryPrompt("OUTRAS REGRAS", PY),
        },
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
    await summarizeNode(request(), deps(llm));
    const res = await summarizeNode(
      request(),
      deps(llm, { reviewModel: "r/x" }),
    );
    expect(requests).toHaveLength(4);
    expect(requests[3]?.model).toBe("r/x");
    expect(res).toEqual({
      status: "ok",
      fromCache: false,
      review: "full",
      result: summarized(2),
      update: ["model-or-prompt"],
    });
  });

  it("regenerates with update neighbours when a neighbour is renamed, and replaces the entry (CACHE-03, CACHE-04)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await summarizeNode(request(), deps(llm));
    const renamed = request({ calls: ["buscar_tabela", "aplicar_imposto"] });
    const res = await summarizeNode(renamed, deps(llm));
    expect(requests).toHaveLength(4);
    expect(res).toMatchObject({ fromCache: false, update: ["neighbours"] });
    expect(await readdir(nodesDir())).toHaveLength(1);
    const again = await summarizeNode(renamed, deps(llm));
    expect(requests).toHaveLength(4);
    expect(again).toMatchObject({ fromCache: true });
    expect("update" in again).toBe(false);
  });

  it("regenerates with update code when the code changes (CACHE-03, CACHE-04)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await summarizeNode(request(), deps(llm));
    const res = await summarizeNode(
      request({ code: CODE.replace("return 10", "return 12") }),
      deps(llm),
    );
    expect(requests).toHaveLength(4);
    expect(res).toMatchObject({ fromCache: false, update: ["code"] });
  });

  it("hits the cache for the same code at another position and shifts every line (CACHE-05)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await summarizeNode(request(), deps(llm));
    const moved = await summarizeNode(
      request({ range: { start: 11, end: 14 } }),
      deps(llm),
    );
    expect(requests).toHaveLength(2);
    expect(moved).toEqual({
      status: "ok",
      fromCache: true,
      review: "full",
      result: summarized(11),
    });
  });

  it("serves the same code after 3 blank lines from cache with every line +3 and no update (Independent Test P2)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await summarizeNode(request(), deps(llm));
    const source = `\n\n\n${SOURCE}`;
    const range = { start: RANGE.start + 3, end: RANGE.end + 3 };
    const res = await summarizeNode(
      request({ code: sliceLines(source, range), range }),
      deps(llm),
    );
    expect(requests).toHaveLength(2);
    expect(res).toEqual({
      status: "ok",
      fromCache: true,
      review: "full",
      result: summarized(5),
    });
    expect("update" in res).toBe(false);
  });

  it("serves code that differs only by CRLF or trailing spaces from cache (CACHE-01)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await summarizeNode(request(), deps(llm));
    const crlf = await summarizeNode(
      request({ code: CODE.replace(/\n/g, "\r\n") }),
      deps(llm),
    );
    const trailing = await summarizeNode(
      request({ code: CODE.replace(/\n/g, " \t\n") }),
      deps(llm),
    );
    expect(requests).toHaveLength(2);
    expect(crlf).toMatchObject({ fromCache: true });
    expect(trailing).toMatchObject({ fromCache: true });
  });

  it.each([1, 3])(
    "regenerates over a v%i entry without update and stores version 4 (CACHE-07, CFG-04)",
    async (version) => {
      await mkdir(nodesDir(), { recursive: true });
      await writeFile(
        nodeFile("fn:calcular_frete"),
        JSON.stringify({ schemaVersion: version, key: "k", result: draft }),
        "utf8",
      );
      const { llm, requests } = fakeLlm(ANSWER);
      const res = await summarizeNode(request(), deps(llm));
      expect(requests).toHaveLength(2);
      expect(res).toEqual({
        status: "ok",
        fromCache: false,
        review: "full",
        result: summarized(2),
      });
      const stored = JSON.parse(
        await readFile(nodeFile("fn:calcular_frete"), "utf8"),
      );
      expect(stored.schemaVersion).toBe(4);
    },
  );

  it("regenerates over a corrupted entry without update and overwrites it (CACHE-07)", async () => {
    await mkdir(nodesDir(), { recursive: true });
    await writeFile(nodeFile("fn:calcular_frete"), "{ corrompido", "utf8");
    const { llm, requests } = fakeLlm(ANSWER);
    const res = await summarizeNode(request(), deps(llm));
    expect(res).toEqual({
      status: "ok",
      fromCache: false,
      review: "full",
      result: summarized(2),
    });
    const again = await summarizeNode(request(), deps(llm));
    expect(requests).toHaveLength(2);
    expect(again).toMatchObject({ fromCache: true });
  });

  it("returns no-key without llm and without cache (CORE-19)", async () => {
    expect(await summarizeNode(request(), deps(undefined))).toEqual({
      status: "no-key",
    });
  });

  it("returns the cached ok without llm when the cache has the entry (CORE-19)", async () => {
    const { llm } = fakeLlm(ANSWER);
    const first = await summarizeNode(request(), deps(llm));
    const res = await summarizeNode(request(), deps(undefined));
    expect(res).toEqual({ ...first, fromCache: true });
  });

  it("returns error and writes nothing when the LLM throws (CORE-20)", async () => {
    const { llm } = fakeLlm(() => {
      throw new Error("rede caiu");
    });
    const res = await summarizeNode(request(), deps(llm));
    expect(res).toEqual({ status: "error", message: "rede caiu" });
    expect(await readdir(dir)).toEqual([]);
  });

  it("returns error when the LLM answers invalid JSON (CORE-20)", async () => {
    const { llm } = fakeLlm("isto não é JSON");
    const res = await summarizeNode(request(), deps(llm));
    expect(res.status).toBe("error");
    expect(await readdir(dir)).toEqual([]);
  });

  it("returns unfaithful and writes nothing when no summary sentence survives (FID-01, FID-10)", async () => {
    const { llm, requests } = fakeLlm(
      JSON.stringify({ ...draft, summary: "Custa 7 kg." }),
    );
    const res = await summarizeNode(request(), deps(llm));
    expect(res).toEqual({ status: "unfaithful" });
    expect(requests).toHaveLength(6);
    expect(await readdir(dir)).toEqual([]);
  });

  it("stores only the reviewed summary, with relative lines and no suggestions (FID-01, CFG-04)", async () => {
    const raw = JSON.stringify({ ...draft, summary: `${SUMMARY} Custa 7 kg.` });
    const { llm } = fakeLlm(raw);
    await summarizeNode(request(), deps(llm));
    const stored = JSON.parse(
      await readFile(nodeFile("fn:calcular_frete"), "utf8"),
    );
    expect(stored.review).toBe("cut");
    expect(stored.result).toEqual(summarized(1));
    expect(await readdir(dir)).toEqual(["nodes"]);
  });

  it("asks for json 'native' whatever the model: the client's profile decides the rest", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await summarizeNode(
      request(),
      deps(llm, { model: "google/gemini-x", reviewModel: "google/gemini-x" }),
    );
    await summarizeNode(
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
    await summarizeNode(request(), deps(first.llm));
    const same = fakeLlm(ANSWER);
    expect(await summarizeNode(request(), deps(same.llm))).toMatchObject({
      fromCache: true,
    });
    expect(same.requests).toHaveLength(0);

    const other = fakeLlm(ANSWER);
    const res = await summarizeNode(
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
    const failing: PartCache<Summary> = {
      get: async () => undefined,
      set: async () => {
        throw new Error("disco cheio");
      },
    };
    const { llm } = fakeLlm(ANSWER);
    const res = await summarizeNode(
      request(),
      deps(llm, { summaryCache: failing }),
    );
    expect(res).toEqual({
      status: "ok",
      fromCache: false,
      review: "full",
      result: summarized(2),
    });
    spy.mockRestore();
  });
});

describe("cachedOnly (CFG-05)", () => {
  it("answers not-cached on a miss and never calls the LLM", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    expect(
      await summarizeNode(request(), deps(llm), { cachedOnly: true }),
    ).toEqual({ status: "not-cached" });
    expect(
      await suggestNode(request(), deps(llm), { cachedOnly: true }),
    ).toEqual({ status: "not-cached" });
    expect(requests).toHaveLength(0);
    expect(await readdir(dir)).toEqual([]);
  });

  it("answers not-cached, not no-key, without an LLM", async () => {
    expect(
      await summarizeNode(request(), deps(undefined), { cachedOnly: true }),
    ).toEqual({ status: "not-cached" });
  });

  it("serves a hit with no call", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    const first = await summarizeNode(request(), deps(llm));
    const hit = await summarizeNode(request(), deps(llm), {
      cachedOnly: true,
    });
    expect(requests).toHaveLength(2);
    expect(hit).toEqual({ ...first, fromCache: true });
  });

  it("answers not-cached for a stale entry and never replaces it", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await summarizeNode(request(), deps(llm));
    const stale = await summarizeNode(
      request({ code: CODE.replace("return 10", "return 12") }),
      deps(llm),
      { cachedOnly: true },
    );
    expect(stale).toEqual({ status: "not-cached" });
    expect(requests).toHaveLength(2);
    expect(
      await summarizeNode(request(), deps(llm), { cachedOnly: true }),
    ).toMatchObject({ status: "ok", fromCache: true });
  });
});

describe("suggestNode (CFG-02)", () => {
  it("makes one draft with the suggestions prompt and one review, and returns only the suggestions in their own folder", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    const res = await suggestNode(request(), deps(llm));
    expect(requests).toHaveLength(2);
    expect(requests[0]?.messages[0]).toEqual({
      role: "system",
      content: prompts.suggestions.text,
    });
    // Only the suggestion reaches the reviewer.
    expect(user(requests[1])).toContain("- g1: ");
    expect(user(requests[1])).not.toContain("- s1: ");
    expect(res).toEqual({
      status: "ok",
      fromCache: false,
      review: "full",
      result: suggested(2),
    });
    expect(await readdir(dir)).toEqual(["suggestions"]);
    const stored = JSON.parse(
      await readFile(fileIn("suggestions", "fn:calcular_frete"), "utf8"),
    );
    expect(stored.result).toEqual(suggested(1));
  });

  it("serves the second opening from cache with no call (CACHE-02)", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    const first = await suggestNode(request(), deps(llm));
    const second = await suggestNode(request(), deps(llm));
    expect(requests).toHaveLength(2);
    expect(second).toEqual({ ...first, fromCache: true });
  });

  it("drops suggestions outside the node from the response and the cache (CORE-22)", async () => {
    const raw = JSON.stringify({
      ...draft,
      suggestions: [0, 2, 5, 99].map(suggestionAt),
    });
    const { llm } = fakeLlm(raw);
    const res = await suggestNode(request(), deps(llm));
    expect(res).toEqual({
      status: "ok",
      fromCache: false,
      review: "full",
      result: suggested(2),
    });
  });

  it("answers ok with an empty list, and caches it, when every suggestion is cut (CFG-02)", async () => {
    const { llm, requests } = fakeLlm(ANSWER, (id) => id.startsWith("g"));
    const res = await suggestNode(request(), deps(llm));
    expect(res).toEqual({
      status: "ok",
      fromCache: false,
      review: "cut",
      result: [],
    });
    const calls = requests.length;
    expect(await suggestNode(request(), deps(llm))).toMatchObject({
      status: "ok",
      fromCache: true,
      result: [],
    });
    expect(requests).toHaveLength(calls);
  });

  it("answers ok with an empty list when the model suggests nothing", async () => {
    const { llm } = fakeLlm(JSON.stringify({ ...draft, suggestions: [] }));
    expect(await suggestNode(request(), deps(llm))).toEqual({
      status: "ok",
      fromCache: false,
      review: "full",
      result: [],
    });
  });

  it("returns no-key and error like the summary (CORE-19, CORE-20)", async () => {
    expect(await suggestNode(request(), deps(undefined))).toEqual({
      status: "no-key",
    });
    const { llm } = fakeLlm(() => {
      throw new Error("rede caiu");
    });
    expect(await suggestNode(request(), deps(llm))).toEqual({
      status: "error",
      message: "rede caiu",
    });
  });

  it("never touches the summary cache, nor the summary the suggestions cache", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await summarizeNode(request(), deps(llm));
    await suggestNode(request(), deps(llm));
    expect(requests).toHaveLength(4);
    expect((await readdir(dir)).sort()).toEqual(["nodes", "suggestions"]);
  });
});

describe("summary of a step (VID-28)", () => {
  const step = (overrides: Partial<ExplainRequest> = {}) =>
    request({
      nodeId: "fn:calcular_frete/s0",
      nodeName: "requests.get",
      nodeKind: "external",
      calls: [],
      calledBy: [],
      ...overrides,
    });

  it("uses the step prompt and the kind label for a step, and the summary prompt for a function", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await summarizeNode(step(), deps(llm));
    expect(requests[0]?.messages[0]).toEqual({
      role: "system",
      content: prompts.stepSummary.text,
    });
    expect(user(requests[0])).toContain("Tipo: chamada externa");
    await summarizeNode(request(), deps(llm));
    expect(requests[2]?.messages[0]).toEqual({
      role: "system",
      content: prompts.summary.text,
    });
    expect(user(requests[2])).toContain("Tipo: função");
  });

  it("uses the suggestions prompt for a step too", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await suggestNode(step(), deps(llm));
    expect(requests[0]?.messages[0]?.content).toBe(prompts.suggestions.text);
  });

  it("keeps at most 2 sentences of a 3-sentence step draft", async () => {
    const raw = JSON.stringify({
      ...draft,
      summary: `${SUMMARY} Lê \`peso\`. Devolve um valor.`,
    });
    const { llm } = fakeLlm(raw);
    const res = await summarizeNode(step(), deps(llm));
    expect(res).toMatchObject({
      status: "ok",
      review: "full",
      result: {
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
    const res = await summarizeNode(request(), deps(llm));
    expect(res.status === "ok" && res.result.sentences).toHaveLength(3);
  });

  it("caches a step with the step prompt version, reopens with 0 calls and updates on a new step prompt", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await summarizeNode(step(), deps(llm));
    const stored = JSON.parse(
      await readFile(nodeFile("fn:calcular_frete/s0"), "utf8"),
    );
    expect(stored.fingerprint.promptVersion).toBe(prompts.stepSummary.version);
    expect(prompts.stepSummary.version).not.toBe(prompts.summary.version);

    const again = await summarizeNode(step(), deps(llm));
    expect(requests).toHaveLength(2);
    expect(again).toMatchObject({ status: "ok", fromCache: true });

    const res = await summarizeNode(
      step(),
      deps(llm, {
        prompts: {
          ...prompts,
          stepSummary: buildStepSummaryPrompt("OUTRAS REGRAS", PY),
        },
      }),
    );
    expect(requests).toHaveLength(4);
    expect(res).toMatchObject({
      fromCache: false,
      update: ["model-or-prompt"],
    });
  });
});

describe("docstring: judged by the suggestions, never seen by the summary (CFG-03, CFG-04)", () => {
  const DOC = { text: "Calcula o imposto.", line: 2 };
  const reflects = (value: boolean) => ({
    ...draft,
    suggestions: [],
    docstring: {
      reflects: value,
      reason: "Fala de imposto, mas `peso` só define o frete.",
    },
  });

  it("adds the Docstring block before the numbered code of the suggestions request only when the request has one", async () => {
    const withDoc = fakeLlm(JSON.stringify(reflects(true)));
    await suggestNode(request({ docstring: DOC }), deps(withDoc.llm));
    expect(user(withDoc.requests[0])).toContain(
      "Docstring (pode estar desatualizada; não use para resumir; compare com o código):\nCalcula o imposto.\nCódigo:",
    );

    const without = fakeLlm(ANSWER);
    await suggestNode(request(), deps(without.llm));
    expect(user(without.requests[0])).not.toContain("Docstring");
  });

  it("never sends the docstring to the summary", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await summarizeNode(request({ docstring: DOC }), deps(llm));
    for (const r of requests) {
      for (const m of r.messages) {
        expect(m.content).not.toContain("Docstring");
        expect(m.content).not.toContain("Calcula o imposto.");
      }
    }
  });

  it("keeps the summary cached when only the docstring changes, and asks the suggestions again", async () => {
    const { llm, requests } = fakeLlm(ANSWER);
    await summarizeNode(request({ docstring: DOC }), deps(llm));
    await suggestNode(request({ docstring: DOC }), deps(llm));
    expect(requests).toHaveLength(4);
    const edited = request({
      docstring: { ...DOC, text: "Calcula o frete." },
    });
    expect(await summarizeNode(edited, deps(llm))).toMatchObject({
      fromCache: true,
    });
    expect(await suggestNode(edited, deps(llm))).toMatchObject({
      fromCache: false,
      update: ["code"],
    });
    expect(requests).toHaveLength(6);
  });

  it("adds a first suggestion at the docstring line when reflects is false", async () => {
    const { llm } = fakeLlm(JSON.stringify(reflects(false)));
    const res = await suggestNode(request({ docstring: DOC }), deps(llm));
    expect(res.status === "ok" && res.result).toEqual([
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
      const res = await suggestNode(
        request({ docstring: DOC, nodeId: "fn:x" }),
        deps(llm),
      );
      expect(res.status === "ok" && res.result).toEqual([]);
    }
  });

  it("adds nothing when the request has no docstring, even if the model answers the field", async () => {
    const { llm } = fakeLlm(JSON.stringify(reflects(false)));
    const res = await suggestNode(request(), deps(llm));
    expect(res.status === "ok" && res.result).toEqual([]);
  });

  it("keeps at most 5 suggestions, dropping the last other one", async () => {
    const others = [1, 2, 3, 4, 5].map((n) => ({
      ...suggestionAt(2),
      command: `Valide \`peso\` ${"a".repeat(n)}.`,
    }));
    const { llm } = fakeLlm(
      JSON.stringify({ ...reflects(false), suggestions: others }),
    );
    const res = await suggestNode(request({ docstring: DOC }), deps(llm));
    const list = res.status === "ok" ? res.result : [];
    expect(list).toHaveLength(5);
    expect(list[0]?.command).toMatch(/^Atualize a docstring: /);
    expect(list[4]?.command).toBe(others[3]?.command);
  });
});
