import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { type FakeCall, fakeLog, resetFake } from "./fake-llm";

// Feature 04, story P1 (fidelity), end to end through the REAL review pipeline:
// the keyed server (4319) drafts, checks, reviews, redrafts and cuts against the
// scripted fake LLM (e2e/fake-llm.ts). /api/explain is never intercepted.

const REAL = "http://127.0.0.1:4319";
const OFFLINE = "http://127.0.0.1:4317";
const CACHE = fileURLToPath(new URL("../.cache/e2e-real", import.meta.url));

const VIDEO = readFileSync(
  new URL(
    "../packages/extract-python/src/__tests__/fixtures/pedido_frete.py",
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

async function generate(page: Page, base: string, source: string) {
  await page.goto(`${base}/`);
  await page.getByLabel("Trecho Python").fill(source);
  await page.getByRole("button", { name: "Gerar mapa" }).click();
}

const drafts = (log: FakeCall[]) => log.filter((c) => c.role === "draft");
const reviews = (log: FakeCall[]) => log.filter((c) => c.role === "review");
const text = (call: FakeCall) => JSON.stringify(call.messages);

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
    await nodeById(page, "fn:pesar_caixa").click();

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
    await nodeById(page, "fn:somar_itens").click();

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
    await nodeById(page, "fn:contar_partes").click();

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
    await nodeById(page, "fn:media_notas").click();

    const view = panel(page);
    await expect(badge(view)).toHaveText("Revisado");
    await expect(
      view
        .getByRole("heading", { name: "Sugestões", exact: true })
        .locator("xpath=following-sibling::ul[1]")
        .getByRole("button", { name: /\(linha \d+, / }),
    ).toHaveText(["Tratar a lista vazia (linha 3, alta)"]);
    await expect(view).not.toContainText("Remover o laço repetido");
    await expect(
      nodeById(page, "fn:media_notas").getByTitle("Sugestões"),
    ).toHaveText("1");
  });

  test("FID-11/12/13/15/06/14: a faithful draft is fully reviewed, with evidence lines and effects", async ({
    page,
  }) => {
    await generate(page, REAL, VIDEO);
    await nodeById(page, "fn:calcular_frete").click();

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

    await nodeById(page, "fn:processar_pedido").click();
    await expect(
      panel(page).getByText("Nenhum efeito externo.", { exact: true }),
    ).toHaveCount(1);
  });

  test("FID-14: with no key the effects still show and the LLM is never called", async ({
    page,
  }) => {
    await generate(page, OFFLINE, VIDEO);
    await nodeById(page, "fn:calcular_frete").click();

    const view = panel(page);
    await expect(
      view.getByText("Configure OPENROUTER_API_KEY para ver resumos", {
        exact: true,
      }),
    ).toHaveCount(1);
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
    await nodeById(page, "fn:esperar").click();

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

    const retried = page.waitForResponse(`${REAL}/api/explain`);
    await view.getByRole("button", { name: "Tentar de novo" }).click();
    expect(await (await retried).json()).toEqual({ status: "unfaithful" });
    log = await fakeLog();
    expect(drafts(log)).toHaveLength(6);
    expect(reviews(log)).toHaveLength(0);
    expect(cachedFiles()).toEqual([]);
  });
});
