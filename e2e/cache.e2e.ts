import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { type FakeCall, fakeLog, resetFake } from "./fake-llm";

// Feature 04, story P2 (cache by node), end to end through the REAL pipeline and
// the REAL disk cache of the keyed server (4319), against the fake LLM.

const REAL = "http://127.0.0.1:4319";
const CACHE = fileURLToPath(new URL("../.cache/e2e-real", import.meta.url));

const VIDEO = readFileSync(
  new URL(
    "../packages/extract-python/src/__tests__/fixtures/pedido_frete.py",
    import.meta.url,
  ),
  "utf8",
).replace(/\r\n/g, "\n");
const FRETE = "fn:calcular_frete";
const PEDIDO = "fn:processar_pedido";

const canvas = (page: Page) => page.getByRole("application");
const nodeById = (page: Page, id: string) =>
  canvas(page).locator(`[aria-roledescription="node"][data-id="${id}"]`);
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Detalhe do nó" });
const badge = (view: Locator) => view.locator(".review-badge");
const evidence = (view: Locator, id: string) =>
  view.locator(`[data-claim-id="${id}"]`).getByRole("button", { name: /^L/ });
const markedLines = (view: Locator) =>
  view
    .locator('[aria-current="true"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-line")));

/** Fills the snippet and clicks "Gerar mapa"; loads the page only the first time. */
async function generate(page: Page, source: string) {
  if (!page.url().startsWith(REAL)) await page.goto(`${REAL}/`);
  await page.getByLabel("Trecho Python").fill(source);
  await page.getByRole("button", { name: "Gerar mapa" }).click();
}

/** Selects the node and returns the body of its /api/explain answer. */
async function open(page: Page, id: string): Promise<{ fromCache?: boolean }> {
  const response = page.waitForResponse(`${REAL}/api/explain`);
  await nodeById(page, id).click();
  return (await response).json();
}

const freteCalls = (log: FakeCall[]) =>
  log.filter((c) =>
    c.messages.some((m) => m.content.includes("def calcular_frete")),
  );

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

test.describe("Cache por nó", () => {
  test("CACHE-02: reopening an unchanged node comes from the cache", async ({
    page,
  }) => {
    await generate(page, VIDEO);
    expect((await open(page, FRETE)).fromCache).toBe(false);
    await expect(badge(panel(page))).toHaveText("Revisado");

    // Only to change the selection: the fake answers 500 for this node.
    await open(page, PEDIDO);
    await expect(
      panel(page).getByText("Resumo indisponível", { exact: true }),
    ).toHaveCount(1);

    expect((await open(page, FRETE)).fromCache).toBe(true);
    await expect(badge(panel(page))).toHaveText("Revisado");
    expect(freteCalls(await fakeLog())).toHaveLength(2);
  });

  test("CACHE-03/04/06, IT P2: renaming a neighbour regenerates and says why", async ({
    page,
  }) => {
    await generate(page, VIDEO);
    await open(page, FRETE);
    await expect(badge(panel(page))).toHaveText("Revisado");
    expect(await fakeLog()).toHaveLength(2);
    await expect(panel(page).getByRole("status")).toHaveCount(0);

    await generate(
      page,
      VIDEO.replace("def processar_pedido(", "def processar("),
    );
    expect((await open(page, FRETE)).fromCache).toBe(false);

    await expect(panel(page).getByRole("status")).toHaveText(
      "Resumo atualizado: os vizinhos mudaram",
    );
    const log = await fakeLog();
    expect(log).toHaveLength(4);
    const lastDraft = log.filter((c) => c.role === "draft").at(-1);
    const lastUser = lastDraft?.messages
      .filter((m) => m.role === "user")
      .at(-1);
    expect(lastUser?.content.split("\n")).toContain("Chamado por: processar");
    expect(cachedFiles()).toHaveLength(1);
  });

  test("CACHE-04: changing the node code regenerates and says the code changed", async ({
    page,
  }) => {
    await generate(page, VIDEO);
    await open(page, FRETE);
    await expect(badge(panel(page))).toHaveText("Revisado");

    await generate(page, VIDEO.replace("base = 10", "base = 12"));
    await open(page, FRETE);

    await expect(panel(page).getByRole("status")).toHaveText(
      "Resumo atualizado: o código mudou",
    );
  });

  test("CACHE-05/02, IT P2: moving the node keeps the cache and shifts the evidence lines", async ({
    page,
  }) => {
    await generate(page, VIDEO);
    await open(page, FRETE);
    const view = panel(page);
    await expect(evidence(view, "s1")).toHaveText(["L5"]);

    await generate(
      page,
      VIDEO.replace("def calcular_frete", "\n\n\ndef calcular_frete"),
    );
    expect((await open(page, FRETE)).fromCache).toBe(true);

    expect(await fakeLog()).toHaveLength(2);
    await expect(evidence(view, "s1")).toHaveText(["L8"]);
    await expect(evidence(view, "s2")).toHaveText(["L11–12"]);
    await expect(evidence(view, "o1")).toHaveText(["L12, L14"]);
    await evidence(view, "s1").click();
    await expect(view.locator('[aria-current="true"]')).toHaveCount(1);
    expect(await markedLines(view)).toEqual(["8"]);
    await expect(view.getByText(/Resumo atualizado/)).toHaveCount(0);
    await expect(badge(view)).toHaveText("Revisado");
  });
});
