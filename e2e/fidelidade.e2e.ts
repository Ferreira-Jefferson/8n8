import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { type FakeCall, fakeLog, resetFake } from "./fake-llm";

// Feature 04, story P1 (fidelity), end to end through the REAL review pipeline:
// the keyed server (4319) drafts, checks, reviews, redrafts and cuts against the
// scripted fake LLM (e2e/fake-llm.ts). /api/summary is never intercepted.
// Feature 05: one click opens a node, and title requests (roles "title" and
// "title-review") come with each level; the call counts here look only at
// drafts and reviews (D2).

const REAL = "http://127.0.0.1:4319";
const OFFLINE = "http://127.0.0.1:4317";
const CACHE = fileURLToPath(new URL("../.cache/e2e-real", import.meta.url));
/** Keyed server with no model set (CORE-21). */
const DEFAULT_MODEL_SERVER = "http://127.0.0.1:4320";
const DEFAULT_CACHE = fileURLToPath(
  new URL("../.cache/e2e-default-model", import.meta.url),
);

const VIDEO = readFileSync(
  new URL(
    "../packages/languages/python/src/__tests__/fixtures/pedido_frete.py",
    import.meta.url,
  ),
  "utf8",
).replace(/\r\n/g, "\n");
const PTS_FIRST_LINE = readFileSync(
  new URL("../docs/portugues-tecnico-simplificado.md", import.meta.url),
  "utf8",
).split(/\r?\n/)[0] as string;

const canvas = (page: Page) => page.getByRole("application");
const nodeById = (page: Page, id: string) =>
  canvas(page).locator(`[aria-roledescription="node"][data-id="${id}"]`);
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Detalhe do nó" });
const badge = (view: Locator) => view.locator(".review-badge");
const summaryItems = (view: Locator) =>
  view.getByRole("list", { name: "Resumo" }).locator(":scope > li > span");
const evidence = (view: Locator, id: string) =>
  view.locator(`[data-claim-id="${id}"]`).getByRole("button", { name: /^L/ });
const markedLines = (view: Locator) =>
  view
    .locator('[aria-current="true"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-line")));

/** Clicks a card even when the zoom leaves it off-screen; it must be visible first. */
async function clickCard(page: Page, id: string): Promise<void> {
  const card = nodeById(page, id);
  await expect(card).toBeVisible();
  await card.dispatchEvent("click");
}

/**
 * Opens calcular_frete through the loop of processar_pedido and its call; the
 * call card shows the panel of calcular_frete (VID-24). The loop's own summary
 * request is unscripted and fails (with no key: no request); the fake log is cleared after it, so the
 * counts below see only calcular_frete.
 */
async function openFrete(
  page: Page,
  loopState = "Resumo indisponível",
  clearLog = true,
): Promise<void> {
  await clickCard(page, "fn:processar_pedido/s1");
  // Without a provider both parts say so: the first one is enough here (CFG-09).
  await expect(
    panel(page).getByText(loopState, { exact: true }).first(),
  ).toBeVisible();
  if (clearLog) await resetFake();
  await clickCard(page, "fn:processar_pedido/s1/s0");
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(
    "Calcular frete",
  );
}

async function generate(page: Page, base: string, source: string) {
  await page.goto(`${base}/`);
  await page.getByRole("button", { name: /Colar trecho/ }).click();
  await page.getByLabel("Trecho de código").fill(source);
  await page.getByRole("button", { name: "Gerar mapa" }).click();
}

const drafts = (log: FakeCall[]) => log.filter((c) => c.role === "draft");
const reviews = (log: FakeCall[]) => log.filter((c) => c.role === "review");
const text = (call: FakeCall) => JSON.stringify(call.messages);
/** Every message content of the call, as the LLM reads it. */
const sent = (call: FakeCall) => call.messages.map((m) => m.content).join("\n");

function cachedFiles(): string[] {
  const dir = `${CACHE}/nodes`;
  return existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".json"))
    : [];
}

test.beforeEach(async () => {
  await resetFake();
  rmSync(CACHE, { recursive: true, force: true });
});

test.describe("Fidelidade", () => {
  test("FID-02/03/08/09: the unsupported '5 kg' sentence is cut after two redrafts", async ({
    page,
  }) => {
    await generate(
      page,
      REAL,
      "def pesar_caixa(caixa):\n    return caixa.peso\n",
    );
    await clickCard(page, "fn:pesar_caixa");

    const view = panel(page);
    await expect(badge(view)).toHaveText("Revisado com cortes");
    await expect(summaryItems(view)).toHaveText(["Devolve o peso da caixa."]);
    await expect(view).not.toContainText("5 kg");

    const log = await fakeLog();
    expect(drafts(log)).toHaveLength(3);
    expect(reviews(log)).toHaveLength(3);
    for (const redraft of drafts(log).slice(1)) {
      expect(
        redraft.messages.filter((m) => m.role === "assistant"),
      ).toHaveLength(1);
      const last = redraft.messages.at(-1);
      expect(last?.role).toBe("user");
      expect(last?.content.startsWith("Problemas encontrados:")).toBe(true);
      expect(last?.content).toContain("- s2 «A caixa pesa 5 kg.»");
    }
    for (const review of reviews(log)) {
      expect(text(review)).not.toContain("pesa 5 kg");
    }
  });

  test("FID-04: a sentence citing an invented `calcular_imposto` is cut after two redrafts", async ({
    page,
  }) => {
    await generate(
      page,
      REAL,
      "def somar_itens(itens):\n    return sum(itens)\n",
    );
    await clickCard(page, "fn:somar_itens");

    const view = panel(page);
    await expect(badge(view)).toHaveText("Revisado com cortes");
    await expect(summaryItems(view)).toHaveText(["Soma os itens da lista."]);
    await expect(view).not.toContainText("calcular_imposto");
  });

  test("FID-07: supported sentences with an evidence line outside the node, or none, are cut", async ({
    page,
  }) => {
    await generate(
      page,
      REAL,
      "def contar_partes(texto):\n    partes = texto.split()\n    return len(partes)\n",
    );
    await clickCard(page, "fn:contar_partes");

    const view = panel(page);
    await expect(badge(view)).toHaveText("Revisado com cortes");
    await expect(summaryItems(view)).toHaveText(["Divide o texto em partes."]);
    await expect(view).not.toContainText("Devolve o total de partes.");
    await expect(view).not.toContainText("Ignora as partes vazias.");
  });

  test("CORE-22: a suggestion on a line outside the node is dropped, the valid one stays", async ({
    page,
  }) => {
    await generate(
      page,
      REAL,
      "def media_notas(notas):\n    total = sum(notas)\n    return total / len(notas)\n",
    );
    await clickCard(page, "fn:media_notas");

    const view = panel(page);
    await expect(badge(view)).toHaveText("Revisado");
    await expect(
      view
        .getByRole("heading", { name: "Sugestões", exact: true })
        .locator("xpath=following-sibling::ul[1]")
        .getByRole("button", { name: /\(linha \d+, / }),
    ).toHaveText(["Tratar a lista vazia (linha 3, alta)"]);
    await expect(view).not.toContainText("Remover o laço repetido");
    // The open level is the inside of media_notas; its card is one level up.
    await page.getByRole("button", { name: "Voltar" }).click();
    await expect(
      nodeById(page, "fn:media_notas").getByTitle("Sugestões"),
    ).toHaveText("1");
  });

  test("FID-11/12/13/15/06/14: a faithful draft is fully reviewed, with evidence lines and effects", async ({
    page,
  }) => {
    await generate(page, REAL, VIDEO);
    await openFrete(page);

    const view = panel(page);
    await expect(badge(view)).toHaveText("Revisado");
    await expect(evidence(view, "s1")).toHaveText(["L5"]);
    await expect(evidence(view, "s2")).toHaveText(["L8–9"]);
    await expect(evidence(view, "o1")).toHaveText(["L9, L11"]);
    await expect(
      view.getByRole("button", {
        name: "Guardar a tabela de frete em cache (linha 5, media)",
        exact: true,
      }),
    ).toHaveCount(1);

    await expect(view.locator('[aria-current="true"]')).toHaveCount(0);
    await evidence(view, "s2").click();
    await expect(view.locator('[aria-current="true"]')).toHaveCount(2);
    expect(await markedLines(view)).toEqual(["8", "9"]);

    await expect(
      view
        .getByRole("list", { name: "Efeitos externos" })
        .getByRole("listitem"),
    ).toHaveText(["requests.get (HTTP, linha 5)"]);

    const log = await fakeLog();
    expect(drafts(log).map((c) => c.model)).toEqual(["e2e/drafter"]);
    expect(reviews(log).map((c) => c.model)).toEqual(["e2e/reviewer"]);
    const review = text(reviews(log)[0] as FakeCall);
    expect(review).toContain("processar_pedido");
    expect(review).not.toContain("Nó:");
    expect(review).not.toContain(PTS_FIRST_LINE);

    await page
      .getByRole("navigation", { name: "Caminho de navegação" })
      .getByRole("button", { name: "Fluxo principal" })
      .click();
    await clickCard(page, "fn:processar_pedido");
    await expect(
      panel(page).getByText("Nenhum efeito externo.", { exact: true }),
    ).toHaveCount(1);
  });

  test("CORE-17/FID-06/FID-05: the LLM gets only the node code, the neighbour names and, for the review, the draft", async ({
    page,
  }) => {
    const other = "def registrar_log(msg):\n    print(msg)\n";
    await generate(page, REAL, `${VIDEO}\n\n${other}`);
    await openFrete(page);
    const view = panel(page);
    // Any reviewed answer, so the requests are all in; the exact badge is checked last.
    await expect(badge(view)).toHaveText(/^Revisado/);
    // The suggestions are a request of their own (CFG-02): wait for them too.
    await expect(
      view.getByText("Guardar a tabela de frete em cache", { exact: false }),
    ).toHaveCount(1);

    const nodeLines = VIDEO.split("\n").slice(3, 11);
    const outside = [
      "import requests",
      "total = 0",
      "for item in itens:",
      "return total",
      "registrar_log",
      "print(msg)",
    ];
    const log = await fakeLog();
    const draft = drafts(log)[0] as FakeCall;
    const review = reviews(log)[0] as FakeCall;
    const suggestReview = log.find((c) => c.role === "suggest-review");

    // CORE-17: the node code and the direct neighbour, nothing else of the snippet.
    for (const line of nodeLines) expect(sent(draft)).toContain(line.trim());
    expect(sent(draft)).toContain("processar_pedido");
    for (const piece of outside) expect(sent(draft)).not.toContain(piece);

    // FID-06: the node code, the neighbour and the draft items; no drafter turn.
    const items = [
      "Busca a tabela de frete com `requests.get`.",
      "Dobra a taxa quando `peso` passa de 30.",
      "`peso`",
      "`distancia`",
      "valor do frete",
    ];
    for (const line of nodeLines) expect(sent(review)).toContain(line.trim());
    expect(sent(review)).toContain("processar_pedido");
    for (const item of items) expect(sent(review)).toContain(item);
    // The suggestions go to a review of their own, never to the summary's (CFG-02).
    for (const item of [
      "Guardar a tabela de frete em cache",
      "A função busca a tabela na rede a cada chamada.",
    ]) {
      expect(sent(review)).not.toContain(item);
      expect(sent(suggestReview as FakeCall)).toContain(item);
    }
    for (const piece of outside) expect(sent(review)).not.toContain(piece);
    for (const message of draft.messages) {
      expect(sent(review)).not.toContain(message.content);
    }

    // FID-05: each item is classified, with evidence lines, and the panel shows them.
    const asks = review.messages.find((m) => m.role === "system")?.content;
    expect(asks).toContain('"supported"');
    expect(asks).toContain('"evidence"');
    await expect(evidence(view, "s1")).toHaveText(["L5"]);
    await expect(evidence(view, "i1")).toHaveText(["L4"]);
    await expect(evidence(view, "o1")).toHaveText(["L9, L11"]);
    await expect(badge(view)).toHaveText("Revisado");
    expect(drafts(log)).toHaveLength(1);
    expect(reviews(log)).toHaveLength(1);
  });

  test("CORE-21/FID-15: with no model set, draft and review use ~deepseek/deepseek-v4-flash-latest", async ({
    page,
  }) => {
    rmSync(DEFAULT_CACHE, { recursive: true, force: true });
    await generate(page, DEFAULT_MODEL_SERVER, VIDEO);
    await openFrete(page);
    await expect(badge(panel(page))).toHaveText("Revisado");

    const log = await fakeLog();
    expect(drafts(log).map((c) => c.model)).toEqual([
      "~deepseek/deepseek-v4-flash-latest",
    ]);
    expect(reviews(log).map((c) => c.model)).toEqual([
      "~deepseek/deepseek-v4-flash-latest",
    ]);
  });

  test("FID-14: with no key the effects still show and the LLM is never called", async ({
    page,
  }) => {
    await generate(page, OFFLINE, VIDEO);
    // The log is never cleared here: the whole test makes no LLM call.
    await openFrete(
      page,
      "Configure um provedor de LLM em Configurações.",
      false,
    );

    const view = panel(page);
    await expect(
      view.getByText("Configure um provedor de LLM em Configurações.", {
        exact: true,
      }),
    ).toHaveCount(2);
    await expect(
      view
        .getByRole("list", { name: "Efeitos externos" })
        .getByRole("listitem"),
    ).toHaveText(["requests.get (HTTP, linha 5)"]);
    expect(await fakeLog()).toEqual([]);
  });

  test("FID-10/01: no faithful sentence gives the unfaithful message and nothing is cached", async ({
    page,
  }) => {
    await generate(page, REAL, "def esperar(fila):\n    return fila.pop()\n");
    await clickCard(page, "fn:esperar");

    const view = panel(page);
    await expect(
      view.getByText("Não foi possível gerar um resumo fiel.", { exact: true }),
    ).toHaveCount(1);
    await expect(
      view.getByRole("button", { name: "Tentar de novo" }),
    ).toHaveCount(1);
    await expect(badge(view)).toHaveCount(0);
    let log = await fakeLog();
    expect(drafts(log)).toHaveLength(3);
    expect(reviews(log)).toHaveLength(0);

    const retried = page.waitForResponse(`${REAL}/api/summary`);
    await view.getByRole("button", { name: "Tentar de novo" }).click();
    expect(await (await retried).json()).toEqual({ status: "unfaithful" });
    log = await fakeLog();
    expect(drafts(log)).toHaveLength(6);
    expect(reviews(log)).toHaveLength(0);
    expect(cachedFiles()).toEqual([]);
  });
});
