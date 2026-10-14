import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import {
  backButton,
  box,
  breadcrumb,
  canvas,
  cardNames,
  cardOf,
  cardsOutsideCanvas,
  cardTags,
  centre,
  clickCard,
  css,
  edges,
  expectLevel,
  FRETE,
  FRETE_LEVEL,
  generate,
  LIME,
  MAIN_FLOW,
  nodeById,
  nodes,
  OFFLINE,
  openMarks,
  PEDIDO,
  panel,
  VIDEO,
} from "./mapa";

// Feature 05, navigation (VID-18..27): one click opens a node's inner flow and
// shows its panel; "Voltar" and Esc go back one level at a time. On the server
// with no key (4317): the trail shows provisional names (VID-19 allows them).
// On the keyed server, a title or summary that arrives while a level opens can
// leave that level blank (bug reported apart), so these specs avoid that race.

/** The inner level of processar_pedido: its 8 steps, RETORNO included (VID-20). */
const PEDIDO_LEVEL = [...MAIN_FLOW.slice(1), `${PEDIDO}/s7`];
/** A function that calls itself (VID-24 edge case). */
const RECURSIVE = "def contar(n):\n    if n > 0:\n        contar(n - 1)\n";
/** A loop and a with block, each with a call inside (VID-24). */
const LOOP_AND_BLOCK =
  'def g(itens):\n    for i in itens:\n        print(i)\n    with open("x") as f:\n        f.read()\n';
/** The committed folder fixture (feature 02); opening it only reads it. */
const LOJA = fileURLToPath(
  new URL(
    "../packages/extract-python/src/__tests__/fixtures/projeto-loja",
    import.meta.url,
  ),
);
/** Side room of a fitted level: 24 px, or 48 px when it wraps; top room 140 px (design C11). */
const SIDE_ROOM = 48;
const TOP_ROOM = 140;
const BOTTOM_ROOM = 24;

const crumbs = (page: Page) =>
  breadcrumb(page).getByRole("button").allTextContents();
/** The trail as read: items joined by " › " (VID-19). */
const trail = (page: Page) =>
  breadcrumb(page).evaluate((el) => el.textContent?.replace(/\s+/g, " "));
/** Outgoing wires of a card on the level. */
const wiresFrom = (page: Page, id: string) =>
  edges(page).evaluateAll(
    (els, from) =>
      els.filter((el) =>
        (el.getAttribute("aria-label") ?? "").startsWith(
          `Edge from ${from} to `,
        ),
      ).length,
    id,
  );
const ids = (page: Page) =>
  nodes(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));

/** Every card of the level lies inside the visible canvas (layout fit). */
async function expectAllInside(page: Page): Promise<void> {
  await expect.poll(() => cardsOutsideCanvas(page)).toEqual([]);
}

/**
 * The card we came back to is selected and centred in the free area of the
 * canvas (below "Voltar" and the trail), within 2 px. It may sit off-centre
 * only on a side where the level already touches the free area's edge, so no
 * card leaves the view (VID-27; design C11, "o mais perto possível do centro").
 */
async function expectSelectedNearCentre(page: Page, id: string) {
  await expect(cardOf(page, id)).toHaveClass(/\bon\b/);
  expect(await css(cardOf(page, id), "border-top-color")).toBe(LIME);
  await expectAllInside(page);
  await expect
    .poll(async () => {
      const c = await box(canvas(page));
      const v = centre(await box(cardOf(page, id)));
      const cards = await Promise.all(
        (await nodes(page).all()).map((n) => box(n.locator(".node"))),
      );
      const right = Math.max(...cards.map((b) => b.x + b.width));
      const left = Math.min(...cards.map((b) => b.x));
      const bottom = Math.max(...cards.map((b) => b.y + b.height));
      const top = Math.min(...cards.map((b) => b.y));
      const cx = c.x + c.width / 2;
      const cy = c.y + (TOP_ROOM + c.height - BOTTOM_ROOM) / 2;
      return [
        v.x >= cx - 2 || right >= c.x + c.width - SIDE_ROOM - 2,
        v.x <= cx + 2 || left <= c.x + SIDE_ROOM + 2,
        v.y >= cy - 2 || bottom >= c.y + c.height - BOTTOM_ROOM - 2,
        v.y <= cy + 2 || top <= c.y + TOP_ROOM + 2,
      ];
    })
    .toEqual([true, true, true, true]);
}

test.describe("Navegação", () => {
  test("VID-23, IT P1: one click on Calcular frete opens HTTP, EXTERNO, SE and two RETORNO and shows the panel", async ({
    page,
  }) => {
    await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    await expect(panel(page)).toHaveCount(0);
    await clickCard(page, `${PEDIDO}/s3`);
    await expectLevel(page, FRETE_LEVEL);
    expect(await cardTags(page)).toEqual([
      "HTTP",
      "EXTERNO",
      "SE",
      "RETORNO",
      "RETORNO",
    ]);
    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(
      "Calcular frete",
    );
  });

  test("VID-18: the clicked card grows into a lime frame over the canvas before the inner steps show", async ({
    page,
  }) => {
    await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    const c = await box(canvas(page));
    await clickCard(page, `${PEDIDO}/s3`);

    await expect(canvas(page)).toHaveAttribute("data-phase", "expanding");
    const frame = page.locator(".open-frame");
    await expect(frame).toHaveCount(1);
    expect(await css(frame, "border-top-color")).toBe(LIME);
    expect(await css(frame, "border-top-width")).toBe("2px");
    expect(
      await nodes(page).evaluateAll(
        (els, f) =>
          els.filter((el) => el.getAttribute("data-id")?.startsWith(`${f}/`))
            .length,
        FRETE,
      ),
    ).toBe(0);
    // The frame grows to cover the canvas.
    await expect(frame).toHaveAttribute(
      "style",
      `left: 0px; top: 0px; width: ${c.width}px; height: ${c.height}px;`,
    );

    await expect(canvas(page)).toHaveAttribute("data-phase", "open");
    await expect(frame).toHaveCount(0);
    await expectLevel(page, FRETE_LEVEL);
    await expect(canvas(page)).toHaveClass(/\blevel-frame\b/);
    expect(await css(canvas(page), "border-top-color")).toBe(LIME);
  });

  test("VID-19: the trail reads Fluxo principal › <title of each opened node>", async ({
    page,
  }) => {
    await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    await expect.poll(() => trail(page)).toBe("Fluxo principal");
    await clickCard(page, `${PEDIDO}/s3`);
    await expectLevel(page, FRETE_LEVEL);
    await expect
      .poll(() => trail(page))
      .toBe("Fluxo principal › Calcular frete");

    await backButton(page).click();
    await expectLevel(page, MAIN_FLOW);
    await clickCard(page, PEDIDO);
    await expectLevel(page, PEDIDO_LEVEL);
    await clickCard(page, `${PEDIDO}/s3`);
    await expectLevel(page, FRETE_LEVEL);
    await expect
      .poll(() => trail(page))
      .toBe("Fluxo principal › Processar pedido › Calcular frete");
    // Each item keeps its full name in title (the middle ones may end in "…").
    const buttons = breadcrumb(page).getByRole("button");
    for (const b of await buttons.all()) {
      expect(await b.getAttribute("title")).toBe(await b.textContent());
    }
    const one = await box(buttons.first());
    const last = await box(buttons.last());
    expect(Math.abs(one.y - last.y)).toBeLessThan(2);
  });

  test("VID-20: RETORNO steps have no outgoing wire, in calcular_frete and in processar_pedido", async ({
    page,
  }) => {
    const graph = await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    await clickCard(page, `${PEDIDO}/s3`);
    await expectLevel(page, FRETE_LEVEL);
    await expect(edges(page)).toHaveCount(4);
    for (const id of [`${FRETE}/s2/b0/s0`, `${FRETE}/s2/b1/s0`]) {
      expect(await cardOf(page, id).getAttribute("data-tag")).toBe("RETORNO");
      expect(await wiresFrom(page, id)).toBe(0);
      expect(
        await css(cardOf(page, id).locator(".port-out"), "visibility"),
      ).toBe("hidden");
    }

    await backButton(page).click();
    await expectLevel(page, MAIN_FLOW);
    await clickCard(page, PEDIDO);
    await expectLevel(page, PEDIDO_LEVEL);
    const ret = `${PEDIDO}/s7`;
    expect(await cardOf(page, ret).getAttribute("data-tag")).toBe("RETORNO");
    expect(graph.nodes.find((n) => n.id === ret)?.range).toEqual({
      start: 14,
      end: 14,
    });
    expect(await wiresFrom(page, `${PEDIDO}/s6`)).toBe(1);
    expect(await wiresFrom(page, ret)).toBe(0);
    expect(
      graph.edges.filter(
        (e) => e.source === ret || e.source.startsWith(`${FRETE}/s2/b`),
      ),
    ).toEqual([]);

    // A step after the if: the "não" wire reaches it, the RETORNO's never does.
    await generate(
      page,
      OFFLINE,
      "def f(x):\n    if x:\n        return 1\n    print(x)\n",
    );
    await expectLevel(page, ["fn:f", "fn:f/s1"]);
    await clickCard(page, "fn:f");
    await expectLevel(page, ["fn:f/s0", "fn:f/s0/b0/s0", "fn:f/s1"]);
    expect(await cardTags(page)).toEqual(["SE", "RETORNO", "EXTERNO"]);
    await expect(edges(page)).toHaveCount(2);
    expect(await wiresFrom(page, "fn:f/s0")).toBe(2);
    expect(await wiresFrom(page, "fn:f/s0/b0/s0")).toBe(0);
  });

  test("VID-21: the first step of sim sits above the first step of não, each wire labelled", async ({
    page,
  }) => {
    await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    await clickCard(page, `${PEDIDO}/s3`);
    await expectLevel(page, FRETE_LEVEL);
    const sim = await box(cardOf(page, `${FRETE}/s2/b0/s0`));
    const nao = await box(cardOf(page, `${FRETE}/s2/b1/s0`));
    expect(sim.y + sim.height).toBeLessThanOrEqual(nao.y);
    await expect(page.locator("[data-branch-label]")).toHaveText([
      "sim",
      "não",
    ]);
    expect(await css(page.locator('[data-branch-label="sim"]'), "color")).toBe(
      LIME,
    );
  });

  test("VID-22: clicking a leaf draws its border in lime", async ({ page }) => {
    await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    const leaf = cardOf(page, `${PEDIDO}/s1`);
    expect(await css(leaf, "border-top-color")).not.toBe(LIME);
    await clickCard(page, `${PEDIDO}/s1`);
    await expect(leaf).toHaveClass(/\bon\b/);
    expect(await css(leaf, "border-top-color")).toBe(LIME);
    expect(
      await css(cardOf(page, `${PEDIDO}/s2`), "border-top-color"),
    ).not.toBe(LIME);
  });

  test("VID-25: clicking the HTTP leaf shows its panel and keeps the same 5 cards", async ({
    page,
  }) => {
    await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    await clickCard(page, `${PEDIDO}/s3`);
    await expectLevel(page, FRETE_LEVEL);
    const before = await crumbs(page);
    await clickCard(page, `${FRETE}/s0`);
    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(
      "Get",
    );
    expect(await ids(page)).toEqual(FRETE_LEVEL);
    expect(await crumbs(page)).toEqual(before);
    await expect(canvas(page)).toHaveAttribute("data-phase", "open");
  });

  test("VID-27: Voltar is off and Esc does nothing at the top; below, each goes up one level and selects the node we came from", async ({
    page,
  }) => {
    await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    await expect(backButton(page)).toBeDisabled();
    // Top left of the canvas.
    const b = await box(backButton(page));
    const c = await box(canvas(page));
    expect(b.x - c.x).toBe(24);
    expect(b.y - c.y).toBe(24);
    await page.keyboard.press("Escape");
    expect(await ids(page)).toEqual(MAIN_FLOW);
    expect(await crumbs(page)).toEqual(["Fluxo principal"]);

    await clickCard(page, PEDIDO);
    await expectLevel(page, PEDIDO_LEVEL);
    await clickCard(page, `${PEDIDO}/s3`);
    await expectLevel(page, FRETE_LEVEL);
    await expect(backButton(page)).toBeEnabled();

    await page.keyboard.press("Escape");
    await expectLevel(page, PEDIDO_LEVEL);
    await expect
      .poll(() => crumbs(page))
      .toEqual(["Fluxo principal", "Processar pedido"]);
    await expectSelectedNearCentre(page, `${PEDIDO}/s3`);

    await backButton(page).click();
    await expectLevel(page, MAIN_FLOW);
    expect(await crumbs(page)).toEqual(["Fluxo principal"]);
    await expectSelectedNearCentre(page, PEDIDO);
    await expect(backButton(page)).toBeDisabled();
  });
});

test.describe("Descida até as folhas", () => {
  test("VID-24/26: cards of PASTA, ARQUIVO, GATILHO, FUNÇÃO, LAÇO and BLOCO show › and the others do not", async ({
    page,
  }) => {
    await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    const opens = new Set(["GATILHO", "FUNÇÃO", "LAÇO", "BLOCO"]);
    for (const level of [MAIN_FLOW, PEDIDO_LEVEL]) {
      if (level === PEDIDO_LEVEL) {
        await clickCard(page, PEDIDO);
        await expectLevel(page, PEDIDO_LEVEL);
      }
      const tags = await cardTags(page);
      expect(await openMarks(page)).toEqual(
        tags.map((t) => opens.has(t ?? "")),
      );
    }
    expect(
      await css(cardOf(page, `${PEDIDO}/s3`).locator(".open-mark"), "color"),
    ).toBe(LIME);

    // LAÇO and BLOCO open; the call inside the loop is a leaf.
    await generate(page, OFFLINE, LOOP_AND_BLOCK);
    await expectLevel(page, ["fn:g", "fn:g/s0", "fn:g/s1"]);
    expect(await cardTags(page)).toEqual(["GATILHO", "LAÇO", "BLOCO"]);
    expect(await openMarks(page)).toEqual([true, true, true]);
    await clickCard(page, "fn:g/s0");
    await expectLevel(page, ["fn:g/s0/s0"]);
    expect(await openMarks(page)).toEqual([false]);

    // PASTA and ARQUIVO open.
    await page.goto(`${OFFLINE}/`);
    await page.getByLabel("Caminho da pasta").fill(LOJA);
    await page.getByRole("button", { name: "Abrir pasta" }).click();
    await expect(nodes(page)).toHaveCount(4);
    await expect(nodes(page).first()).toBeVisible();
    expect(await openMarks(page)).toEqual([true, true, true, true]);
    await clickCard(page, "dir:pedidos");
    await expect(nodes(page)).toHaveCount(3);
    expect(await cardTags(page)).toEqual(["ARQUIVO", "ARQUIVO", "ARQUIVO"]);
    expect(await openMarks(page)).toEqual([true, true, true]);
  });

  test("VID-24 edge: opening a recursive call stacks the same level again, one click at a time", async ({
    page,
  }) => {
    await generate(page, OFFLINE, RECURSIVE);
    await expectLevel(page, ["fn:contar", "fn:contar/s0"]);
    await clickCard(page, "fn:contar");
    const inner = ["fn:contar/s0", "fn:contar/s0/b0/s0"];
    await expectLevel(page, inner);
    expect(await cardTags(page)).toEqual(["SE", "FUNÇÃO"]);
    await clickCard(page, "fn:contar/s0/b0/s0");
    await expect
      .poll(() => crumbs(page))
      .toEqual(["Fluxo principal", "Contar", "Contar"]);
    await expectLevel(page, inner);
    // The descent waits for the next click.
    await page.waitForTimeout(1500);
    expect(await crumbs(page)).toHaveLength(3);
    await clickCard(page, "fn:contar/s0/b0/s0");
    await expect.poll(() => crumbs(page)).toHaveLength(4);
    await expectLevel(page, inner);
    await backButton(page).click();
    await expect.poll(() => crumbs(page)).toHaveLength(3);
    await expectLevel(page, inner);
    await expect(cardOf(page, "fn:contar/s0/b0/s0")).toHaveClass(/\bon\b/);
  });

  for (const size of [
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1600, height: 900 },
  ]) {
    test(`IT P1, VID-23..27 at ${size.width}x${size.height}: walk the video code down to every leaf and back, every card always in view`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(size);
      await generate(page, OFFLINE, VIDEO);
      await expectLevel(page, MAIN_FLOW);
      // Panel closed: the whole level is in view.
      await expect(panel(page)).toHaveCount(0);
      await expectAllInside(page);

      const opened: string[] = [];
      const leafLevels: string[][] = [];
      let leaves = 0;
      let backs = 0;

      async function walk(depth: number): Promise<void> {
        expect(depth).toBeLessThan(5);
        const level = (await ids(page)) as string[];
        for (const id of level) await expect(nodeById(page, id)).toBeVisible();
        await expectAllInside(page);
        const marks = await openMarks(page);
        if (!marks.some(Boolean)) leafLevels.push(level);
        for (const [i, id] of level.entries()) {
          const trailBefore = await crumbs(page);
          const name = (await cardNames(page))[i];
          await clickCard(page, id);
          if (marks[i]) {
            opened.push(id);
            await expect
              .poll(() => crumbs(page))
              .toHaveLength(trailBefore.length + 1);
            await expect.poll(() => ids(page)).not.toEqual(level);
            await expect(panel(page)).toHaveCount(1);
            await walk(depth + 1);
            // Alternate Esc and "Voltar": both go up exactly one level.
            if (backs++ % 2 === 0) await page.keyboard.press("Escape");
            else await backButton(page).click();
            await expectLevel(page, level);
            expect(await crumbs(page)).toEqual(trailBefore);
            await expectSelectedNearCentre(page, id);
          } else {
            leaves++;
            // A leaf only selects and shows its panel (VID-25).
            await expect(
              panel(page).getByRole("heading", { level: 2 }),
            ).toHaveText(name as string);
            await expect(cardOf(page, id)).toHaveClass(/\bon\b/);
            expect(await ids(page)).toEqual(level);
            expect(await crumbs(page)).toEqual(trailBefore);
            // The panel took room: the level refits, every card still in view.
            await expectAllInside(page);
          }
        }
      }

      await walk(0);
      expect(opened).toEqual([PEDIDO, `${PEDIDO}/s3`, `${PEDIDO}/s3`]);
      expect(leafLevels).toEqual([FRETE_LEVEL, FRETE_LEVEL]);
      expect(leaves).toBe(6 + 7 + 5 + 5);
      expect(await crumbs(page)).toEqual(["Fluxo principal"]);
      await expect(backButton(page)).toBeDisabled();
      expect(await ids(page)).toEqual(MAIN_FLOW);
    });
  }
});
