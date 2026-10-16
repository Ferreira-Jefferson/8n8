import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Graph } from "@8n8/model";
import { expect, type Locator, type Page } from "@playwright/test";
import { resetFake } from "./fake-llm";

// Helpers shared by the feature 05 specs (mapa-video, titulos, navegacao,
// detalhe, sugestoes). Not a spec: Playwright only runs *.e2e.ts.

/** The server with no key (titles and summaries never come). */
export const OFFLINE = `http://127.0.0.1:${process.env.E2E_PORT ?? 8148}`;
/** The server with the real pipeline against the fake LLM (e2e/fake-llm.ts). */
export const REAL = "http://127.0.0.1:4319";
/** The cache dir of the REAL server, wiped before each test that uses it. */
export const CACHE = fileURLToPath(
  new URL("../.cache/e2e-real", import.meta.url),
);

/** The video code (design, "Código do vídeo"). */
export const VIDEO = readFileSync(
  new URL(
    "../packages/languages/python/src/__tests__/fixtures/pedido_video.py",
    import.meta.url,
  ),
  "utf8",
).replace(/\r\n/g, "\n");

export const PEDIDO = "fn:processar_pedido";
export const FRETE = "fn:calcular_frete";
/** The main flow of the video code: the entry and its seven call commands, then the function it calls (VID-10). */
export const MAIN_FLOW = [
  PEDIDO,
  `${PEDIDO}/s0`,
  `${PEDIDO}/s1`,
  `${PEDIDO}/s2`,
  `${PEDIDO}/s3`,
  `${PEDIDO}/s4`,
  `${PEDIDO}/s5`,
  `${PEDIDO}/s6`,
  FRETE,
];
/** The level inside calcular_frete: HTTP, EXTERNO, SE and two RETORNO (VID-23). */
export const FRETE_LEVEL = [
  `${FRETE}/s0`,
  `${FRETE}/s1`,
  `${FRETE}/s2`,
  `${FRETE}/s2/b0/s0`,
  `${FRETE}/s2/b1/s0`,
];

/** The brand colours (docs/design/manual-marca.html), dark theme. */
export const MAIN = "rgb(61, 191, 168)";
export const GROUND = "rgb(22, 24, 24)";
export const SECOND = "rgb(233, 235, 234)";
export const ACCENT = "rgb(151, 157, 155)";
export const WARM = "rgb(220, 138, 92)";

export const canvas = (page: Page) => page.locator(".canvas");
const flow = (page: Page) => page.getByRole("application");
export const nodes = (page: Page) =>
  flow(page).locator('[aria-roledescription="node"]:not(.hub-node)');
export const nodeById = (page: Page, id: string) =>
  flow(page).locator(`[aria-roledescription="node"][data-id="${id}"]`);
/** The card inside a React Flow node: `div.node` with tag, name and code line. */
export const cardOf = (page: Page, id: string) =>
  nodeById(page, id).locator(".node");
export const edges = (page: Page) =>
  flow(page).locator('[aria-roledescription="edge"]:not(.edge-contains)');
export const breadcrumb = (page: Page) =>
  page.getByRole("navigation", { name: "Caminho de navegação" });
export const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Detalhe do nó" });

/** Clears the fake log and the REAL server's cache. */
export async function freshReal(): Promise<void> {
  await resetFake();
  rmSync(CACHE, { recursive: true, force: true });
}

/** Opens the editor on `base`, pastes `source` and generates the map; returns the graph. */
export async function generate(
  page: Page,
  base: string,
  source: string,
): Promise<Graph> {
  await page.goto(`${base}/`);
  await page.getByRole("button", { name: /Colar trecho/ }).click();
  await page.getByLabel("Trecho de código").fill(source);
  const response = page.waitForResponse("**/api/graph");
  await page.getByRole("button", { name: "Gerar mapa" }).click();
  const { graph } = (await (await response).json()) as { graph: Graph };
  return graph;
}

/** The IDs of the level's cards, in DOM order, once the level is drawn. */
export async function levelIds(page: Page): Promise<string[]> {
  await expect(nodes(page).first()).toBeVisible();
  return nodes(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-id") ?? ""),
  );
}

/** Waits until the level shows exactly `ids`, all drawn. */
export async function expectLevel(page: Page, ids: string[]): Promise<void> {
  await expect
    .poll(() =>
      nodes(page).evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-id")),
      ),
    )
    .toEqual(ids);
  for (const id of ids) await expect(nodeById(page, id)).toBeVisible();
}

/** The card titles of the level, without the "›" open mark, in DOM order (VID-15). */
export const cardNames = (page: Page) =>
  nodes(page).evaluateAll((els) =>
    els.map((el) => el.querySelector(".name")?.firstChild?.textContent ?? ""),
  );

/** The tag of each card of the level (VID-04). */
export const cardTags = (page: Page) =>
  nodes(page).evaluateAll((els) =>
    els.map((el) => el.querySelector("[data-tag]")?.getAttribute("data-tag")),
  );

/** Whether each card shows the "›" open mark (VID-26). */
export const openMarks = (page: Page) =>
  nodes(page).evaluateAll((els) =>
    els.map((el) => el.querySelector(".open-mark")?.textContent === "›"),
  );

/** Clicks a card once; it must be visible first (one click opens, VID-23). */
export async function clickCard(page: Page, id: string): Promise<void> {
  const card = nodeById(page, id);
  await expect(card).toBeVisible();
  await card.dispatchEvent("click");
}

/** A computed style value of the first match. */
export function css(target: Locator, prop: string): Promise<string> {
  return target.evaluate(
    (el, p) => getComputedStyle(el).getPropertyValue(p),
    prop,
  );
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function box(target: Locator): Promise<Box> {
  const b = await target.boundingBox();
  if (!b) throw new Error("no bounding box");
  return b;
}

/** The centre of a box. */
export const centre = (b: Box) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

/** Card IDs whose box is not wholly inside the visible canvas. */
export async function cardsOutsideCanvas(page: Page): Promise<string[]> {
  const c = await box(canvas(page));
  const out: string[] = [];
  for (const card of await nodes(page).all()) {
    const b = await box(card.locator(".node"));
    const inside =
      b.x >= c.x - 0.5 &&
      b.y >= c.y - 0.5 &&
      b.x + b.width <= c.x + c.width + 0.5 &&
      b.y + b.height <= c.y + c.height + 0.5;
    if (!inside) out.push((await card.getAttribute("data-id")) ?? "");
  }
  return out;
}
