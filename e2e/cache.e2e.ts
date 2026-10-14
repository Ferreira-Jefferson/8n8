import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { type FakeCall, fakeLog, resetFake } from "./fake-llm";

// Feature 04, story P2 (cache by node), end to end through the REAL pipeline and
// the REAL disk cache of the keyed server (4319), against the fake LLM.
// Feature 05: calcular_frete is not on the main flow, so it opens through the
// loop of processar_pedido and its call, whose card shows the panel of
// calcular_frete (VID-24). The call counts look only at the drafts and reviews
// of calcular_frete (D2): titles and the loop's own request are not about it.

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
  if (!page.url().startsWith(REAL)) {
    await page.goto(`${REAL}/`);
    await page.getByRole("button", { name: /Colar trecho/ }).click();
  }
  const newCode = page.getByRole("button", { name: "Novo código" });
  if (await newCode.isVisible()) await newCode.click();
  await page.getByLabel("Trecho Python").fill(source);
  await page.getByRole("button", { name: "Gerar mapa" }).click();
}

/** Clicks a card even when the zoom leaves it off-screen; it must be visible first. */
async function clickCard(page: Page, id: string): Promise<void> {
  const card = nodeById(page, id);
  await expect(card).toBeVisible();
  await card.dispatchEvent("click");
}

/** Clicks the card and returns the body of the /api/explain answer for `explained`. */
async function clickAndExplain(
  page: Page,
  card: string,
  explained: string,
): Promise<{ fromCache?: boolean }> {
  const response = page.waitForResponse(
    (r) =>
      r.url() === `${REAL}/api/explain` &&
      (r.request().postDataJSON() as { nodeId: string }).nodeId === explained,
  );
  await clickCard(page, card);
  return (await response).json();
}

/** Back to the main flow through the breadcrumb. */
async function toTop(page: Page): Promise<void> {
  await page
    .getByRole("navigation", { name: "Caminho de navegação" })
    .getByRole("button", { name: "Fluxo principal" })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Caminho de navegação" })
      .getByRole("button"),
  ).toHaveCount(1);
}

/**
 * Opens a node from the main flow and returns its /api/explain answer: FRETE
 * through the loop and its call, PEDIDO by its own card (only to change the
 * selection: the fake answers 500 for it).
 */
async function open(page: Page, id: string): Promise<{ fromCache?: boolean }> {
  await toTop(page);
  if (id === PEDIDO) return clickAndExplain(page, PEDIDO, PEDIDO);
  // The loop of the entry; its ID follows the entry's name, which some tests rename.
  const loop = canvas(page)
    .locator('[aria-roledescription="node"]')
    .filter({ has: page.locator('[data-tag="LAÇO"]') });
  const loopId = (await loop.getAttribute("data-id")) as string;
  await clickCard(page, loopId);
  return clickAndExplain(page, `${loopId}/s0`, FRETE);
}

/** Drafts and reviews about calcular_frete (D2). */
const freteCalls = (log: FakeCall[]) =>
  log.filter(
    (c) =>
      (c.role === "draft" || c.role === "review") &&
      c.messages.some((m) => m.content.includes("def calcular_frete")),
  );

function cachedFiles(): string[] {
  const dir = `${CACHE}/nodes`;
  return existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".json"))
    : [];
}

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
/** The node's entry: `<cache>/nodes/<sha256(node identity)>.json`; a snippet node's identity is its id. */
const entryFile = (id: string) => join(CACHE, "nodes", `${sha256(id)}.json`);
const fingerprint = (): Record<string, string> =>
  JSON.parse(readFileSync(entryFile(FRETE), "utf8")).fingerprint;

/**
 * Maps `source` again and opens FRETE: the app keeps a map's explanations in
 * memory, so only a new map asks the server, and its disk cache, again.
 */
async function reopenInNewMap(
  page: Page,
  source: string,
): Promise<{ fromCache?: boolean }> {
  await generate(page, source);
  return open(page, FRETE);
}

/** The rewritten entry is read back: reopening FRETE comes from the cache, with no LLM call. */
async function expectValidEntry(page: Page) {
  expect(cachedFiles()).toEqual([`${sha256(FRETE)}.json`]);
  await open(page, PEDIDO);
  expect((await reopenInNewMap(page, VIDEO)).fromCache).toBe(true);
  await expect(badge(panel(page))).toHaveText("Revisado");
  expect(freteCalls(await fakeLog())).toHaveLength(2);
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

    expect((await reopenInNewMap(page, VIDEO)).fromCache).toBe(true);
    await expect(badge(panel(page))).toHaveText("Revisado");
    expect(freteCalls(await fakeLog())).toHaveLength(2);
  });

  test("CACHE-03/04/06, IT P2: renaming a neighbour regenerates and says why", async ({
    page,
  }) => {
    await generate(page, VIDEO);
    await open(page, FRETE);
    await expect(badge(panel(page))).toHaveText("Revisado");
    expect(freteCalls(await fakeLog())).toHaveLength(2);
    await expect(panel(page).getByRole("status")).toHaveCount(0);

    await generate(
      page,
      VIDEO.replace("def processar_pedido(", "def processar("),
    );
    expect((await open(page, FRETE)).fromCache).toBe(false);

    await expect(panel(page).getByRole("status")).toHaveText(
      "Resumo atualizado: os vizinhos mudaram",
    );
    const log = freteCalls(await fakeLog());
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

  test("CACHE-01: the entry keeps each fingerprint component apart", async ({
    page,
  }) => {
    await generate(page, VIDEO);
    await open(page, FRETE);
    await expect(badge(panel(page))).toHaveText("Revisado");
    const first = fingerprint();
    expect(Object.keys(first).sort()).toEqual([
      "code",
      "model",
      "neighbours",
      "promptVersion",
      "reviewModel",
      "reviewerVersion",
    ]);
    expect(first.model).toBe("e2e/drafter");
    expect(first.reviewModel).toBe("e2e/reviewer");
    for (const value of Object.values(first)) expect(value).not.toBe("");

    // Trailing spaces only: the normalized code is the same, so is the entry.
    await generate(page, VIDEO.replace("base = 10", "base = 10   "));
    expect((await open(page, FRETE)).fromCache).toBe(true);
    expect(fingerprint()).toEqual(first);

    const renamed = VIDEO.replace("def processar_pedido(", "def processar(");
    await generate(page, renamed);
    await open(page, FRETE);
    await expect(badge(panel(page))).toHaveText("Revisado");
    const second = fingerprint();
    expect(second.neighbours).not.toBe(first.neighbours);
    expect({ ...second, neighbours: "" }).toEqual({
      ...first,
      neighbours: "",
    });

    await generate(page, renamed.replace("base = 10", "base = 12"));
    await open(page, FRETE);
    await expect(badge(panel(page))).toHaveText("Revisado");
    const third = fingerprint();
    expect(third.code).not.toBe(second.code);
    expect({ ...third, code: "" }).toEqual({ ...second, code: "" });
  });

  test("CACHE-07: a corrupted entry counts as absent and is replaced", async ({
    page,
  }) => {
    mkdirSync(dirname(entryFile(FRETE)), { recursive: true });
    writeFileSync(entryFile(FRETE), '{"schemaVersion": 2, "nodeId": ', "utf8");

    await generate(page, VIDEO);
    expect((await open(page, FRETE)).fromCache).toBe(false);
    await expect(badge(panel(page))).toHaveText("Revisado");
    await expect(panel(page).getByRole("status")).toHaveCount(0);
    expect(freteCalls(await fakeLog())).toHaveLength(2);
    await expectValidEntry(page);
  });

  test("CACHE-07: an old-format entry counts as absent and is replaced", async ({
    page,
  }) => {
    await generate(page, VIDEO);
    await open(page, FRETE);
    await expect(badge(panel(page))).toHaveText("Revisado");
    // The same entry as version 1, with a summary the product never wrote.
    const entry = JSON.parse(readFileSync(entryFile(FRETE), "utf8"));
    entry.schemaVersion = 1;
    entry.result.summary = "Resumo antigo.";
    entry.result.sentences = [{ id: "s1", text: "Resumo antigo.", lines: [1] }];
    writeFileSync(entryFile(FRETE), JSON.stringify(entry), "utf8");
    await resetFake();

    await open(page, PEDIDO);
    expect((await reopenInNewMap(page, VIDEO)).fromCache).toBe(false);
    await expect(badge(panel(page))).toHaveText("Revisado");
    await expect(panel(page)).not.toContainText("Resumo antigo.");
    await expect(panel(page).getByRole("status")).toHaveCount(0);
    expect(freteCalls(await fakeLog())).toHaveLength(2);
    await expectValidEntry(page);
  });

  test("CACHE-07: a feature-01 file is never read and stays on disk", async ({
    page,
  }) => {
    // Feature 01 kept `<dir>/<key>.json` entries with schemaVersion 1.
    const legacy = join(CACHE, `${sha256(FRETE)}.json`);
    const legacyBody = JSON.stringify({
      schemaVersion: 1,
      key: sha256(FRETE),
      model: "e2e/drafter",
      promptVersion: "000000000000",
      createdAt: "2026-01-01T00:00:00.000Z",
      result: {
        summary: "Resumo da feature 01.",
        sentences: [{ id: "s1", text: "Resumo da feature 01.", lines: [1] }],
        inputs: [],
        outputs: [],
        suggestions: [],
      },
    });
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(legacy, legacyBody, "utf8");

    await generate(page, VIDEO);
    expect((await open(page, FRETE)).fromCache).toBe(false);
    await expect(badge(panel(page))).toHaveText("Revisado");
    await expect(panel(page)).not.toContainText("Resumo da feature 01.");
    await expect(panel(page).getByRole("status")).toHaveCount(0);
    expect(freteCalls(await fakeLog())).toHaveLength(2);
    expect(readFileSync(legacy, "utf8")).toBe(legacyBody);
    await expectValidEntry(page);
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

    expect(freteCalls(await fakeLog())).toHaveLength(2);
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
