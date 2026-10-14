import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmClient, TitleItem, TitlesResponse } from "@code2n8n/model";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as api from "../index";
import {
  buildTitlePrompt,
  buildTitleReviewerPrompt,
  createTitleCache,
  type TitleCache,
  type TitleDeps,
  titleNodes,
} from "../index";
import type { Verdict } from "../reviewer";
import { titleMessage } from "../title-prompt";

type LlmRequest = Parameters<LlmClient["complete"]>[0];

const prompt = buildTitlePrompt("REGRAS PTS");
const reviewer = buildTitleReviewerPrompt();

const supportAll = (id: string): Verdict => ({
  id,
  supported: true,
  evidence: [1],
});

/**
 * Fake LLM: a reviewer request (system = reviewer prompt) judges each
 * `- nX: <title>` line with `judge`; any other request gets `titles(user)`.
 */
function fakeLlm(
  titles: (user: string) => string,
  judge: (id: string, title: string) => Verdict = supportAll,
) {
  const requests: LlmRequest[] = [];
  const llm: LlmClient = {
    async complete(req) {
      requests.push(req);
      const system = req.messages[0]?.content;
      const user = req.messages[1]?.content ?? "";
      if (system === reviewer.text) {
        const verdicts = [...user.matchAll(/^- (n\d+): (.*)$/gm)].map(
          ([, id, title]) => judge(id as string, title as string),
        );
        return JSON.stringify({ verdicts });
      }
      return titles(user);
    },
  };
  const isReview = (r: LlmRequest) => r.messages[0]?.content === reviewer.text;
  return {
    llm,
    requests,
    titleRequests: () => requests.filter((r) => !isReview(r)),
    reviews: () => requests.filter(isReview),
  };
}

/** Answers every `[nX] ... | Nome: <name>` block with TITLE_OF[name], or the override. */
const TITLE_OF: Record<string, string> = {
  processar_pedido: "Processar pedido",
  calcular_frete: "Calcular frete",
  "requests.get": "Buscar frete por HTTP",
};
const answerByName =
  (override: Record<string, string> = {}, extra: object[] = []) =>
  (user: string) =>
    JSON.stringify({
      titles: [
        ...[...user.matchAll(/^\[(n\d+)\] .* \| Nome: (.*)$/gm)]
          .map(([, id, name]) => ({
            id,
            title: override[name as string] ?? TITLE_OF[name as string],
          }))
          .reverse(),
        ...extra,
      ],
    });

const PROCESSAR: TitleItem = {
  nodeId: "fn:processar_pedido",
  cacheKey: "fn:processar_pedido",
  kind: "function",
  name: "processar_pedido",
  code: "def processar_pedido(req):\n    return calcular_frete(req)",
  range: { start: 10, end: 11 },
  calls: ["calcular_frete"],
  calledBy: [],
};
const CALCULAR: TitleItem = {
  nodeId: "fn:calcular_frete",
  cacheKey: "fn:calcular_frete",
  kind: "function",
  name: "calcular_frete",
  code: 'def calcular_frete(peso):\n    r = requests.get("x")\n    return r',
  range: { start: 1, end: 3 },
  calls: [],
  calledBy: ["processar_pedido"],
};
const HTTP: TitleItem = {
  nodeId: "fn:calcular_frete/s0",
  cacheKey: "fn:calcular_frete/s0",
  kind: "external",
  name: "requests.get",
  code: '    r = requests.get("x")',
  range: { start: 2, end: 2 },
  calls: [],
  calledBy: [],
};
const ITEMS = [PROCESSAR, CALCULAR, HTTP];

let dir: string;
let cache: TitleCache;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "code2n8n-titles-"));
  cache = createTitleCache(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const deps = (
  llm: LlmClient | undefined,
  extra: Partial<TitleDeps> = {},
): TitleDeps => ({
  llm,
  cache,
  provider: "openrouter",
  model: "openai/gpt-x",
  reviewModel: "openai/gpt-r",
  prompt,
  reviewer,
  ...extra,
});

const FRESH = [
  {
    nodeId: "fn:processar_pedido",
    text: "Processar pedido",
    lines: [10],
    fromCache: false,
  },
  {
    nodeId: "fn:calcular_frete",
    text: "Calcular frete",
    lines: [1],
    fromCache: false,
  },
  {
    nodeId: "fn:calcular_frete/s0",
    text: "Buscar frete por HTTP",
    lines: [2],
    fromCache: false,
  },
];
const CACHED = FRESH.map((t) => ({ ...t, fromCache: true }));

describe("titleNodes (VID-14, VID-16, VID-17)", () => {
  it("titles 3 uncached items with exactly 2 calls, in item order, with absolute lines", async () => {
    const fake = fakeLlm(answerByName());
    const res = await titleNodes({ items: ITEMS }, deps(fake.llm));
    expect(res).toEqual({ status: "ok", titles: FRESH });
    expect(fake.requests).toHaveLength(2);
    expect(fake.titleRequests()[0]?.messages).toEqual([
      { role: "system", content: prompt.text },
      { role: "user", content: titleMessage(ITEMS) },
    ]);
    expect(fake.reviews()[0]?.messages[0]?.content).toBe(reviewer.text);
    expect(fake.titleRequests()[0]?.model).toBe("openai/gpt-x");
    expect(fake.reviews()[0]?.model).toBe("openai/gpt-r");
  });

  it("serves the second time from cache with 0 calls (VID-17)", async () => {
    const fake = fakeLlm(answerByName());
    await titleNodes({ items: ITEMS }, deps(fake.llm));
    const again = await titleNodes({ items: ITEMS }, deps(fake.llm));
    expect(fake.requests).toHaveLength(2);
    expect(again).toEqual({ status: "ok", titles: CACHED });
  });

  it("serves the same code at another position from cache with shifted lines", async () => {
    const fake = fakeLlm(answerByName());
    await titleNodes({ items: [PROCESSAR] }, deps(fake.llm));
    const moved = await titleNodes(
      { items: [{ ...PROCESSAR, range: { start: 20, end: 21 } }] },
      deps(fake.llm),
    );
    expect(fake.requests).toHaveLength(2);
    expect(moved).toEqual({
      status: "ok",
      titles: [{ ...CACHED[0], lines: [20] }],
    });
  });

  /** Asks again only for CALCULAR; the others come from cache. */
  const expectOnlyCalcular = (
    fake: ReturnType<typeof fakeLlm>,
    res: TitlesResponse,
  ) => {
    const user = fake.titleRequests().at(-1)?.messages[1]?.content ?? "";
    expect(user).toContain("[n1] Tipo: função | Nome: calcular_frete");
    expect(user).not.toContain("[n2]");
    expect(user).not.toContain("processar_pedido(req)");
    expect(res).toEqual({
      status: "ok",
      titles: [CACHED[0], FRESH[1], CACHED[2]],
    });
  };

  it("asks again only for the item whose code changed (VID-17)", async () => {
    const fake = fakeLlm(answerByName());
    await titleNodes({ items: ITEMS }, deps(fake.llm));
    const res = await titleNodes(
      {
        items: [
          PROCESSAR,
          { ...CALCULAR, code: CALCULAR.code.replace("return r", "return 0") },
          HTTP,
        ],
      },
      deps(fake.llm),
    );
    expect(fake.requests).toHaveLength(4);
    expectOnlyCalcular(fake, res);
  });

  it("asks again only for the item whose neighbour changed (VID-17)", async () => {
    const fake = fakeLlm(answerByName());
    await titleNodes({ items: ITEMS }, deps(fake.llm));
    const res = await titleNodes(
      { items: [PROCESSAR, { ...CALCULAR, calledBy: ["main"] }, HTTP] },
      deps(fake.llm),
    );
    expect(fake.requests).toHaveLength(4);
    expectOnlyCalcular(fake, res);
  });

  it.each<[string, Partial<TitleDeps>]>([
    ["the provider", { provider: "openai-compatible" }],
    ["the model", { model: "openai/outro" }],
    ["the reviewer model", { reviewModel: "openai/outro" }],
    ["the title prompt version", { prompt: buildTitlePrompt("OUTRAS") }],
    [
      "the reviewer prompt version",
      { reviewer: { ...reviewer, version: "000000000000" } },
    ],
  ])(
    "asks again only for the item cached under another %s (VID-17)",
    async (_, other) => {
      const fake = fakeLlm(answerByName());
      await titleNodes({ items: ITEMS }, deps(fake.llm));
      // CALCULAR alone is now cached under the other setting.
      const otherFake = fakeLlm(answerByName());
      await titleNodes({ items: [CALCULAR] }, deps(otherFake.llm, other));
      expect(otherFake.requests).toHaveLength(2);

      const res = await titleNodes({ items: ITEMS }, deps(fake.llm));
      expect(fake.requests).toHaveLength(4);
      expectOnlyCalcular(fake, res);
    },
  );

  it("leaves a title rejected by the reviewer out of the response and the cache (VID-16)", async () => {
    const fake = fakeLlm(answerByName(), (id, title) =>
      title === "Calcular frete"
        ? { id, supported: false, evidence: [], problem: "não" }
        : supportAll(id),
    );
    const res = await titleNodes({ items: ITEMS }, deps(fake.llm));
    expect(res).toEqual({ status: "ok", titles: [FRESH[0], FRESH[2]] });
    expect(await cache.get("fn:calcular_frete")).toBeUndefined();
    expect(await readdir(join(dir, "titles"))).toHaveLength(2);
  });

  it("drops a title with evidence outside its node (VID-16)", async () => {
    const fake = fakeLlm(answerByName(), (id, title) =>
      title === "Buscar frete por HTTP"
        ? { id, supported: true, evidence: [2] }
        : supportAll(id),
    );
    const res = await titleNodes({ items: ITEMS }, deps(fake.llm));
    expect(res).toEqual({ status: "ok", titles: [FRESH[0], FRESH[1]] });
  });

  it("keeps a 7-word title away from the reviewer and from the response (VID-14)", async () => {
    const fake = fakeLlm(
      answerByName({ calcular_frete: "Calcular o frete do pedido pelo peso" }),
    );
    const res = await titleNodes({ items: ITEMS }, deps(fake.llm));
    expect(res).toEqual({ status: "ok", titles: [FRESH[0], FRESH[2]] });
    const review = fake.reviews()[0]?.messages[1]?.content ?? "";
    expect(review).not.toContain("Calcular o frete");
    expect(review).toContain("Processar pedido");
  });

  it("makes only 1 call when no title passes layer one", async () => {
    const fake = fakeLlm(
      answerByName({ processar_pedido: "Processar pedido de 40 kg" }),
    );
    const res = await titleNodes({ items: [PROCESSAR] }, deps(fake.llm));
    expect(res).toEqual({ status: "ok", titles: [] });
    expect(fake.requests).toHaveLength(1);
    expect(fake.reviews()).toHaveLength(0);
  });

  it("ignores a title id that was not asked (VID-14)", async () => {
    const fake = fakeLlm(
      answerByName({}, [{ id: "n9", title: "Título intruso" }]),
    );
    const res = await titleNodes({ items: ITEMS }, deps(fake.llm));
    expect(res).toEqual({ status: "ok", titles: FRESH });
    const review = fake.reviews()[0]?.messages[1]?.content ?? "";
    expect(review).not.toContain("n9");
    expect(review).not.toContain("intruso");
  });

  it("returns no-key with the cache hits when there is no llm", async () => {
    const fake = fakeLlm(answerByName());
    await titleNodes({ items: [HTTP] }, deps(fake.llm));
    const res = await titleNodes({ items: ITEMS }, deps(undefined));
    expect(res).toEqual({ status: "no-key", titles: [CACHED[2]] });
  });

  it("returns ok with no call and no llm when every item is cached", async () => {
    const fake = fakeLlm(answerByName());
    await titleNodes({ items: ITEMS }, deps(fake.llm));
    const res = await titleNodes({ items: ITEMS }, deps(undefined));
    expect(res).toEqual({ status: "ok", titles: CACHED });
  });

  it("returns error with the cache hits and writes nothing when the LLM throws", async () => {
    const fake = fakeLlm(answerByName());
    await titleNodes({ items: [HTTP] }, deps(fake.llm));
    const failing = fakeLlm(() => {
      throw new Error("rede caiu");
    });
    const res = await titleNodes({ items: ITEMS }, deps(failing.llm));
    expect(res).toEqual({
      status: "error",
      message: "rede caiu",
      titles: [CACHED[2]],
    });
    expect(await readdir(join(dir, "titles"))).toHaveLength(1);
  });

  it("returns error and writes nothing when the answer is invalid JSON or the reviewer fails", async () => {
    const badJson = fakeLlm(() => "isto não é JSON");
    const res = await titleNodes({ items: ITEMS }, deps(badJson.llm));
    expect(res).toMatchObject({ status: "error", titles: [] });

    const badReview = fakeLlm(answerByName());
    badReview.llm.complete = async (req) =>
      req.messages[0]?.content === reviewer.text
        ? '{"verdicts":"nada"}'
        : answerByName()(req.messages[1]?.content ?? "");
    const res2 = await titleNodes({ items: ITEMS }, deps(badReview.llm));
    expect(res2).toMatchObject({ status: "error", titles: [] });
    expect(await readdir(dir)).toEqual([]);
  });

  it("exports the title API and the step prompt from index", () => {
    for (const name of [
      "titleNodes",
      "createTitleCache",
      "buildTitlePrompt",
      "buildTitleReviewerPrompt",
      "buildStepPrompt",
    ]) {
      expect(typeof (api as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
