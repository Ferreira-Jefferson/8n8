import { type FakeCall, fakeLog, resetFake } from "./fake-llm";
import {
  cardNames,
  clickCard,
  css,
  expectLevel,
  FRETE,
  FRETE_LEVEL,
  freshReal,
  generate,
  MAIN_FLOW,
  openTab,
  PEDIDO,
  panel,
  REAL,
  VIDEO,
} from "./mapa";
import { expect, type Locator, type Page, test } from "./test";

// Feature 05, story P2 (VID-28..30): a step inside a function gets its own
// summary of at most 2 sentences, through the real review pipeline on the
// keyed server (4319) against the fake LLM.

const HTTP = `${FRETE}/s0`;
const SUM = `${FRETE}/s1`;
const PESADA = `${FRETE}/s2/b0/s0`;

const drafts = (log: FakeCall[]) => log.filter((c) => c.role === "draft");
const reviews = (log: FakeCall[]) => log.filter((c) => c.role === "review");
const summary = (view: Locator) =>
  view.getByRole("list", { name: "Resumo" }).locator(":scope > li > span");
/** The "Entrada e saída" line as read, without the evidence buttons (VID-30). */
const ioLine = (view: Locator) =>
  view.getByLabel("Entrada e saída").evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const b of copy.querySelectorAll("button")) b.remove();
    return copy.textContent?.replace(/\s+/g, " ").trim();
  });
/** The parts of one tab of the panel in DOM order: tag, class and text (VID-29). */
const sections = (view: Locator, tab: string) =>
  view.locator(`#panel-${tab}`).evaluate((el) =>
    [...el.children].map((c) => {
      const tag = c.tagName.toLowerCase();
      if (tag === "ol") return "ol:Resumo";
      if (tag === "pre") return "pre:code";
      if (tag === "section") return `section:${c.getAttribute("aria-label")}`;
      if (tag === "span") return `span:${c.className}`;
      return `${tag}:${c.textContent}`;
    }),
  );

/** The video map with its titles, then the level inside calcular_frete. */
async function openFrete(page: Page): Promise<void> {
  await generate(page, REAL, VIDEO);
  await expectLevel(page, MAIN_FLOW);
  await expect.poll(() => cardNames(page)).toContain("Calcular frete");
  await clickCard(page, `${PEDIDO}/s3`);
  await expectLevel(page, FRETE_LEVEL);
}

/** Selects a step and waits for its summary. */
async function showStep(page: Page, id: string, first: string) {
  await clickCard(page, id);
  await openTab(page, "Resumo");
  await expect(summary(panel(page)).first()).toHaveText(first);
}

test.beforeEach(freshReal);

test("VID-28, IT P2: the HTTP step shows a reviewed 2-sentence summary; reopening it drafts nothing", async ({
  page,
}) => {
  await openFrete(page);
  await showStep(page, HTTP, "A função consulta uma API externa com o CEP.");
  const view = panel(page);
  await expect(summary(view)).toHaveText([
    "A função consulta uma API externa com o CEP.",
    "A função retorna a UF.",
  ]);
  await expect(view.locator(".review-badge")).toHaveText("Revisado");
  const steps = drafts(await fakeLog()).filter((c) =>
    c.messages.some((m) => m.content.includes("viacep")),
  );
  expect(steps.length).toBeGreaterThan(0);

  await showStep(page, SUM, "Soma o peso dos itens.");
  await resetFake();
  await showStep(page, HTTP, "A função consulta uma API externa com o CEP.");
  const log = await fakeLog();
  expect(drafts(log)).toHaveLength(0);
  expect(reviews(log)).toHaveLength(0);
});

test("VID-28: a step summary keeps 2 sentences and the 3rd never reaches the reviewer", async ({
  page,
}) => {
  await openFrete(page);
  await showStep(page, SUM, "Soma o peso dos itens.");
  await expect(summary(panel(page))).toHaveText([
    "Soma o peso dos itens.",
    "Guarda a soma em `peso`.",
  ]);
  const sumReviews = reviews(await fakeLog()).filter((c) =>
    c.messages.some((m) => m.content.includes("sum(item")),
  );
  expect(sumReviews.length).toBeGreaterThan(0);
  for (const r of sumReviews) {
    expect(JSON.stringify(r.messages)).not.toContain("Usa a função");
  }
  await expect(panel(page).getByText("Usa a função")).toHaveCount(0);
});

test("VID-29: the step panel follows the video order; the rules line shows on steps, not on functions", async ({
  page,
}) => {
  await openFrete(page);
  await showStep(page, HTTP, "A função consulta uma API externa com o CEP.");
  const view = panel(page);
  await expect(view.getByLabel("Entrada e saída")).toBeVisible();
  await expect(view.getByRole("heading", { level: 2 })).toHaveText(
    "Buscar UF pelo CEP",
  );
  // The code is the first tab: it is the one part that always exists.
  await expect(view.getByRole("tab")).toHaveText([
    "Código",
    "Conversa",
    "Resumo",
    /^Sugestões/,
  ]);
  expect(await sections(view, "summary")).toEqual([
    "p:O QUE FAZ · PORTUGUÊS TÉCNICO SIMPLIFICADO",
    "span:review-badge",
    "ol:Resumo",
    "p:2 frases · voz ativa · um termo por conceito",
    "h3:ENTRADA E SAÍDA",
    "section:Entrada e saída",
  ]);
  await openTab(page, "Código");
  expect(await sections(view, "code")).toEqual([
    "h3:CÓDIGO · trecho.py, linha 18",
    "pre:code",
  ]);
  const code = view.locator("pre .code-line");
  await expect(code).toHaveCount(1);
  await expect(code.locator(".line-no")).toHaveText("18");
  await expect(code.locator("code")).toHaveText(
    '    uf = requests.get("https://viacep.com.br/ws/" + cep).json()["uf"]',
  );

  // The function calcular_frete (the card that opened the level): no rules line.
  await page.keyboard.press("Escape");
  await expectLevel(page, MAIN_FLOW);
  await expect(view.getByRole("heading", { level: 2 })).toHaveText(
    "Calcular frete",
  );
  await expect(
    view.getByText("CÓDIGO · trecho.py, linhas 17 a 23", { exact: true }),
  ).toHaveCount(1);
  await openTab(page, "Resumo");
  await expect(summary(view).first()).toHaveText(
    "A função busca a UF com `requests.get`.",
  );
  await expect(
    view.getByText("2 frases · voz ativa · um termo por conceito"),
  ).toHaveCount(0);
  const order = await sections(view, "summary");
  expect(order.slice(0, 3)).toEqual([
    "p:O QUE FAZ · PORTUGUÊS TÉCNICO SIMPLIFICADO",
    "span:review-badge",
    "ol:Resumo",
  ]);
  expect(order.indexOf("h3:ENTRADA E SAÍDA")).toBe(3);
});

test("VID-30: inputs → outputs in DM Mono; a RETORNO with neither omits the section", async ({
  page,
}) => {
  await openFrete(page);
  await showStep(page, HTTP, "A função consulta uma API externa com o CEP.");
  const view = panel(page);
  expect(await ioLine(view)).toBe("cep → uf");
  expect(await css(view.getByLabel("Entrada e saída"), "font-family")).toMatch(
    /^"DM Mono"/,
  );
  expect(await css(view.locator(".io .arrow"), "color")).toBe(
    "rgb(61, 191, 168)",
  );

  await showStep(page, PESADA, "Retorna o valor da tabela pesada para a `uf`.");
  await openTab(page, "Código");
  await expect(
    view.getByText("CÓDIGO · trecho.py, linha 21", { exact: true }),
  ).toHaveCount(1);
  await expect(view.getByText("ENTRADA E SAÍDA", { exact: true })).toHaveCount(
    0,
  );
  await expect(view.getByLabel("Entrada e saída")).toHaveCount(0);
});
