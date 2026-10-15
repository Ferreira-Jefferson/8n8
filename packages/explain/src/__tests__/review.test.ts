import type { LlmClient } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { buildSummaryPrompt } from "../prompt";
import { type ReviewDeps, reviewedDraft } from "../review";
import { buildReviewerPrompt, type Verdict } from "../reviewer";
import { PY } from "./py";

type LlmRequest = Parameters<LlmClient["complete"]>[0];

const prompt = buildSummaryPrompt("REGRAS PTS", PY);
const reviewer = buildReviewerPrompt(PY);

// Code without `5` and without `kg`.
const CODE = ["def pesar_caixa(caixa):", "    return caixa.peso"].join("\n");
const USER = "Nó: pesar_caixa\nCódigo:\n1 | def pesar_caixa(caixa):";

const draft = (d: {
  summary: string;
  inputs?: string[];
  outputs?: string[];
  suggestions?: unknown[];
}) => JSON.stringify({ inputs: [], outputs: [], suggestions: [], ...d });

const FIVE_KG = draft({
  summary: "Devolve o peso da caixa. A caixa pesa 5 kg.",
  inputs: ["`caixa`"],
  outputs: ["peso da caixa"],
});
const CLEAN = draft({
  summary: "Devolve o peso da caixa.",
  inputs: ["`caixa`"],
  outputs: ["peso da caixa"],
});

/** Every reviewed item is supported on line 2 unless `judge` says otherwise. */
const supportAll = (id: string): Verdict => ({
  id,
  supported: true,
  evidence: [2],
});

/**
 * Scripted LLM: reviewer requests (system = reviewer prompt) are answered by
 * judging each `- <id>: <text>` line; draft requests take the next draft,
 * repeating the last one.
 */
function scripted(
  drafts: string[],
  judge: (id: string, text: string) => Verdict = supportAll,
  reviewAnswer?: string,
) {
  const requests: LlmRequest[] = [];
  let n = 0;
  const llm: LlmClient = {
    async complete(req) {
      requests.push(req);
      if (req.messages[0]?.content === reviewer.text) {
        if (reviewAnswer !== undefined) return reviewAnswer;
        const user = req.messages[1]?.content ?? "";
        const verdicts = [...user.matchAll(/^- (\w+): (.*)$/gm)].map(
          ([, id, text]) => judge(id as string, text as string),
        );
        return JSON.stringify({ verdicts });
      }
      const answer = drafts[Math.min(n, drafts.length - 1)] as string;
      n++;
      return answer;
    },
  };
  const isReview = (r: LlmRequest) => r.messages[0]?.content === reviewer.text;
  return {
    llm,
    requests,
    drafts: () => requests.filter((r) => !isReview(r)),
    reviews: () => requests.filter(isReview),
  };
}

const input = {
  user: USER,
  code: CODE,
  neighbours: ["medir", "main"],
};
const deps = (llm: LlmClient, extra: Partial<ReviewDeps> = {}): ReviewDeps => ({
  llm,
  model: "openai/gpt-x",
  reviewModel: "openai/gpt-x",
  prompt,
  reviewer,
  ...extra,
});

describe("reviewedDraft", () => {
  it("cuts the 5 kg sentence after 3 rounds and keeps only s1 (Independent Test P1, FID-09)", async () => {
    const fake = scripted([FIVE_KG]);
    const out = await reviewedDraft(input, deps(fake.llm));
    expect(out).toEqual({
      kind: "ok",
      review: "cut",
      result: {
        summary: "Devolve o peso da caixa.",
        sentences: [{ id: "s1", text: "Devolve o peso da caixa.", lines: [2] }],
        inputs: [{ id: "i1", text: "`caixa`", lines: [2] }],
        outputs: [{ id: "o1", text: "peso da caixa", lines: [2] }],
        suggestions: [],
      },
    });
    expect(fake.requests).toHaveLength(6);
    expect(fake.drafts()).toHaveLength(3);
    expect(fake.reviews()).toHaveLength(3);
    for (const r of fake.reviews()) {
      for (const m of r.messages) expect(m.content).not.toContain("pesa 5 kg");
    }
  });

  it("returns full with 2 calls for a faithful draft (FID-11)", async () => {
    const fake = scripted([CLEAN]);
    const out = await reviewedDraft(input, deps(fake.llm));
    expect(out).toMatchObject({ kind: "ok", review: "full" });
    expect(fake.requests).toHaveLength(2);
    expect(fake.drafts()).toHaveLength(1);
  });

  it("returns full with 4 calls when the second draft is clean", async () => {
    const fake = scripted([FIVE_KG, CLEAN]);
    const out = await reviewedDraft(input, deps(fake.llm));
    expect(out).toEqual({
      kind: "ok",
      review: "full",
      result: {
        summary: "Devolve o peso da caixa.",
        sentences: [{ id: "s1", text: "Devolve o peso da caixa.", lines: [2] }],
        inputs: [{ id: "i1", text: "`caixa`", lines: [2] }],
        outputs: [{ id: "o1", text: "peso da caixa", lines: [2] }],
        suggestions: [],
      },
    });
    expect(fake.requests).toHaveLength(4);
  });

  it("asks a new draft with system, user, assistant and the problem list, never a 4th draft (FID-08)", async () => {
    const fake = scripted([FIVE_KG]);
    await reviewedDraft(input, deps(fake.llm));
    const [first, second, third] = fake.drafts();
    expect(first?.messages).toEqual([
      { role: "system", content: prompt.text },
      { role: "user", content: USER },
    ]);
    const msgs = second?.messages ?? [];
    expect(msgs.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(msgs[0]?.content).toBe(prompt.text);
    expect(msgs[1]?.content).toBe(USER);
    expect(msgs[2]?.content).toBe(FIVE_KG);
    expect(msgs[3]?.content.startsWith("Problemas encontrados:")).toBe(true);
    expect(msgs[3]?.content).toMatch(/^- s2 «A caixa pesa 5 kg\.»: .+$/m);
    expect(third?.messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(fake.drafts()).toHaveLength(3);
  });

  it("lists reviewer rejections in the new draft request too (FID-08)", async () => {
    const fake = scripted([CLEAN, CLEAN], (id) =>
      id === "o1"
        ? { id, supported: false, evidence: [], problem: "não há saída" }
        : supportAll(id),
    );
    await reviewedDraft(input, deps(fake.llm));
    const last = fake.drafts()[1]?.messages[3]?.content ?? "";
    expect(last).toContain("- o1 «peso da caixa»: não há saída");
  });

  it("returns unfaithful without calling the reviewer when layer one rejects everything (FID-10)", async () => {
    const fake = scripted([draft({ summary: "A caixa pesa 5 kg." })]);
    const out = await reviewedDraft(input, deps(fake.llm));
    expect(out).toEqual({ kind: "unfaithful" });
    expect(fake.requests).toHaveLength(3);
    expect(fake.reviews()).toHaveLength(0);
  });

  it("returns unfaithful when the reviewer rejects every summary sentence (FID-10)", async () => {
    const fake = scripted([CLEAN], (id) =>
      id.startsWith("s")
        ? { id, supported: false, evidence: [], problem: "não" }
        : supportAll(id),
    );
    const out = await reviewedDraft(input, deps(fake.llm));
    expect(out).toEqual({ kind: "unfaithful" });
    expect(fake.requests).toHaveLength(6);
  });

  it("drops cut inputs, outputs and suggestions, joins kept sentences and keeps id gaps (FID-09)", async () => {
    const raw = draft({
      summary: "Recebe `caixa`. Pesa 5 kg. Devolve `caixa.peso`.",
      inputs: ["`caixa`", "`tamanho`"],
      outputs: ["peso"],
      suggestions: [
        {
          command: "Valide `caixa`.",
          reason: "Caixa nula quebra.",
          line: 2,
          severity: "alta",
        },
        {
          command: "Use timeout de 10 s.",
          reason: "Evita espera.",
          line: 1,
          severity: "baixa",
        },
      ],
    });
    const fake = scripted([raw], (id) =>
      id === "o1"
        ? { id, supported: false, evidence: [1], problem: "não" }
        : { id, supported: true, evidence: [2, 1, 2] },
    );
    const out = await reviewedDraft(input, deps(fake.llm));
    expect(out).toEqual({
      kind: "ok",
      review: "cut",
      result: {
        summary: "Recebe `caixa`. Devolve `caixa.peso`.",
        sentences: [
          { id: "s1", text: "Recebe `caixa`.", lines: [1, 2] },
          { id: "s3", text: "Devolve `caixa.peso`.", lines: [1, 2] },
        ],
        inputs: [{ id: "i1", text: "`caixa`", lines: [1, 2] }],
        outputs: [],
        suggestions: [
          {
            id: "g1",
            command: "Valide `caixa`.",
            reason: "Caixa nula quebra.",
            line: 2,
            severity: "alta",
            lines: [1, 2],
          },
        ],
      },
    });
  });

  it("sends the reviewer model to the reviewer and the summary model to the draft, both asking json 'native' (the client's profile decides the rest)", async () => {
    const fake = scripted([CLEAN]);
    await reviewedDraft(
      input,
      deps(fake.llm, { model: "openai/gpt-x", reviewModel: "google/rev" }),
    );
    expect(fake.drafts().map((r) => [r.model, r.json])).toEqual([
      ["openai/gpt-x", "native"],
    ]);
    expect(fake.reviews().map((r) => [r.model, r.json])).toEqual([
      ["google/rev", "native"],
    ]);

    const g = scripted([CLEAN]);
    await reviewedDraft(
      input,
      deps(g.llm, { model: "google/sum", reviewModel: "google/sum" }),
    );
    expect(g.requests.map((r) => [r.model, r.json])).toEqual([
      ["google/sum", "native"],
      ["google/sum", "native"],
    ]);
  });

  it("sends the reviewer prompt, the numbered code, the neighbours and only the claims that passed layer one (FID-05, FID-06)", async () => {
    const fake = scripted([FIVE_KG]);
    await reviewedDraft(input, deps(fake.llm));
    const user = fake.reviews()[0]?.messages[1]?.content ?? "";
    expect(user).toContain("1 | def pesar_caixa(caixa):");
    expect(user).toContain("medir, main");
    expect(user).toContain("- s1: Devolve o peso da caixa.");
    expect(user).toContain("- i1: `caixa`");
    expect(user).toContain("- o1: peso da caixa");
    expect(user).not.toContain("s2");
  });

  it("throws when the draft is invalid", async () => {
    const fake = scripted(["isto não é JSON"]);
    await expect(reviewedDraft(input, deps(fake.llm))).rejects.toThrow();
  });

  it("throws when the verdicts are invalid", async () => {
    const fake = scripted([CLEAN], supportAll, '{"verdicts": "nada"}');
    await expect(reviewedDraft(input, deps(fake.llm))).rejects.toThrow();
  });
});

describe("reviewedDraft with maxSentences (VID-28)", () => {
  it("cuts a 3-sentence summary to 2 before the reviewer sees it", async () => {
    const fake = scripted([
      draft({
        summary:
          "Devolve o peso da caixa. Recebe `caixa`. Lê `caixa.peso` uma vez.",
      }),
    ]);
    const out = await reviewedDraft(input, deps(fake.llm, { maxSentences: 2 }));
    expect(out).toEqual({
      kind: "ok",
      review: "full",
      result: {
        summary: "Devolve o peso da caixa. Recebe `caixa`.",
        sentences: [
          { id: "s1", text: "Devolve o peso da caixa.", lines: [2] },
          { id: "s2", text: "Recebe `caixa`.", lines: [2] },
        ],
        inputs: [],
        outputs: [],
        suggestions: [],
      },
    });
    const user = fake.reviews()[0]?.messages[1]?.content ?? "";
    expect(user).not.toContain("uma vez");
    expect(user).not.toContain("s3");
  });

  it("cuts every new draft too (FID-08)", async () => {
    const fake = scripted([
      draft({
        summary: "A caixa pesa 5 kg. Devolve o peso da caixa. Primeira sobra.",
      }),
      draft({
        summary: "Devolve o peso da caixa. Recebe `caixa`. Segunda sobra.",
      }),
    ]);
    const out = await reviewedDraft(input, deps(fake.llm, { maxSentences: 2 }));
    expect(out).toMatchObject({
      kind: "ok",
      review: "full",
      result: { summary: "Devolve o peso da caixa. Recebe `caixa`." },
    });
    expect(fake.drafts()).toHaveLength(2);
    expect(fake.reviews()).toHaveLength(2);
    for (const r of fake.reviews()) {
      for (const m of r.messages) expect(m.content).not.toContain("sobra");
    }
    const redraft = fake.drafts()[1]?.messages[3]?.content ?? "";
    expect(redraft).not.toContain("sobra");
  });
});
