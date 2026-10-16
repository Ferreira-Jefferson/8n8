import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import {
  ACCENT,
  box,
  breadcrumb,
  canvas,
  cardNames,
  cardOf,
  cardTags,
  clickCard,
  css,
  edges,
  expectLevel,
  FRETE,
  FRETE_LEVEL,
  GROUND,
  generate,
  levelIds,
  MAIN,
  MAIN_FLOW,
  nodes,
  OFFLINE,
  PEDIDO,
  panel,
  SECOND,
  VIDEO,
} from "./mapa";

// Feature 05, the look of the video and the editor (VID-01..05, 08, 09), on
// the server with no key (8148): cards show provisional names.

const FIXTURE = fileURLToPath(
  new URL(
    "../packages/languages/python/src/__tests__/fixtures/projeto-loja",
    import.meta.url,
  ),
);

/**
 * One snippet whose main flow and entry level show every snippet tag (VID-04):
 * the main flow has FUNÇÃO, HTTP, BANCO, E-MAIL, DISCO, LAÇO, BLOCO and SE; inside the entry come CÓDIGO, EXTERNO and RETORNO.
 */
const ALL_TAGS = `import requests


def ajudar(x):
    print(x)


def principal(caminho, itens):
    total = 0
    requests.get("https://exemplo.com")
    db.salvar(total)
    enviar_email("a@b.c")
    open(caminho)
    ajudar(total)
    for item in itens:
        print(item)
    with open(caminho) as f:
        f.read()
    if total > 1:
        print(total)
    return total
`;

/** The 14 tags of VID-04. */
const TAGS = [
  "CÓDIGO SOLTO",
  "FUNÇÃO",
  "HTTP",
  "BANCO",
  "DISCO",
  "E-MAIL",
  "EXTERNO",
  "SE",
  "LAÇO",
  "BLOCO",
  "CÓDIGO",
  "RETORNO",
  "PASTA",
  "ARQUIVO",
];

/** Tags of the level once every card is drawn. */
async function levelTags(page: Page): Promise<string[]> {
  await levelIds(page);
  return (await cardTags(page)).map((t) => t ?? "");
}

test.describe("O visual do vídeo", () => {
  test("VID-01: dark canvas with a 40 px dot grid, light titles, grey code, Petróleo open mark", async ({
    page,
  }) => {
    await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);

    expect(await css(canvas(page), "background-color")).toBe(GROUND);
    expect(await css(canvas(page), "background-size")).toBe("40px 40px");
    expect(await css(canvas(page), "background-image")).toMatch(
      /^radial-gradient\(/,
    );
    const trigger = cardOf(page, PEDIDO);
    expect(await css(trigger.locator(".name"), "color")).toBe(SECOND);
    expect(await css(trigger.locator(".fn"), "color")).toBe(ACCENT);
    expect(await css(trigger.locator(".open-mark"), "color")).toBe(MAIN);
    expect(await css(page.locator("body"), "background-color")).toBe(GROUND);
  });

  test("VID-02: Archivo Black, Space Grotesk and DM Mono load, each where the spec puts it, and only from the app", async ({
    page,
  }) => {
    const fontHosts: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith(".woff2")) fontHosts.push(new URL(r.url()).host);
    });
    await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    // A leaf opens the panel, whose title uses the display font (VID-25).
    await clickCard(page, `${PEDIDO}/s1`);
    await expect(panel(page).locator("h2")).toHaveText("Validar pedido");
    await page.evaluate(() => document.fonts.ready);

    for (const family of ["Archivo Black", "Space Grotesk", "DM Mono"]) {
      expect(
        await page.evaluate((f) => document.fonts.check(`16px "${f}"`), family),
      ).toBe(true);
      // check() is also true for a font the page never declared: the face must be loaded.
      expect(
        await page.evaluate(
          (f) =>
            [...document.fonts].some(
              (face) =>
                face.family.replaceAll('"', "") === f &&
                face.status === "loaded",
            ),
          family,
        ),
      ).toBe(true);
    }
    expect(await css(panel(page).locator("h2"), "font-family")).toMatch(
      /^"Archivo Black"/,
    );
    expect(await css(cardOf(page, PEDIDO), "font-family")).toMatch(
      /^"Space Grotesk"/,
    );
    expect(
      await css(cardOf(page, PEDIDO).locator(".fn"), "font-family"),
    ).toMatch(/^"DM Mono"/);
    expect(fontHosts.length).toBeGreaterThan(0);
    expect(new Set(fontHosts)).toEqual(new Set(["127.0.0.1:8148"]));
  });

  test("VID-03: each card has tag, title and code line in that order, with Petróleo round ports only where a wire is", async ({
    page,
  }) => {
    await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);

    const order = await nodes(page).evaluateAll((els) =>
      els.map((el) =>
        [...(el.querySelector(".node")?.children ?? [])]
          .map((c) => c.className)
          .filter((c) => ["tag", "name", "fn"].includes(c)),
      ),
    );
    expect(order).toEqual(MAIN_FLOW.map(() => ["tag", "name", "fn"]));
    // Three lines: the tag in capitals, the title in bold, the code in mono.
    const first = cardOf(page, PEDIDO);
    await expect(first.locator(".tag")).toHaveText("FUNÇÃO");
    expect(Number(await css(first.locator(".name"), "font-weight"))).toBe(700);
    await expect(first.locator(".fn")).toHaveText("processar_pedido()");
    await expect(cardOf(page, `${PEDIDO}/s5`).locator(".fn")).toHaveText(
      "db.salvar()",
    );

    const ports = (id: string) =>
      cardOf(page, id).evaluate((el) => {
        const side = (cls: string) =>
          getComputedStyle(el.querySelector(cls) as Element).visibility;
        return {
          in: side(".port-in.port-left"),
          out: side(".port-out.port-right"),
        };
      });
    expect(await ports(PEDIDO)).toEqual({ in: "hidden", out: "visible" });
    expect(await ports(`${PEDIDO}/s3`)).toEqual({
      in: "visible",
      out: "visible",
    });
    expect(await ports(`${PEDIDO}/s6`)).toEqual({
      in: "visible",
      out: "hidden",
    });
    const port = cardOf(page, `${PEDIDO}/s3`).locator(".port-out.port-right");
    expect(await css(port, "background-color")).toBe(MAIN);
    expect(await css(port, "border-radius")).toBe("50%");
    expect(await css(port, "width")).toBe(await css(port, "height"));
  });

  test("VID-04: the 14 tags all show, and no card shows another", async ({
    page,
  }) => {
    const seen = new Set<string>();
    await generate(page, OFFLINE, ALL_TAGS);
    const top = await levelTags(page);
    // ajudar is called by principal and still shows, as a card with no steps.
    expect(top).toEqual([
      "FUNÇÃO",
      "FUNÇÃO",
      "HTTP",
      "BANCO",
      "E-MAIL",
      "DISCO",
      "FUNÇÃO",
      "LAÇO",
      "BLOCO",
      "SE",
    ]);
    for (const t of top) seen.add(t);
    await clickCard(page, "fn:principal");
    await expect(nodes(page)).toHaveCount(11);
    const inner = await levelTags(page);
    expect(inner).toEqual([
      "CÓDIGO",
      "HTTP",
      "BANCO",
      "E-MAIL",
      "DISCO",
      "FUNÇÃO",
      "LAÇO",
      "BLOCO",
      "SE",
      "EXTERNO",
      "RETORNO",
    ]);
    for (const t of inner) seen.add(t);
    // Loose code is its own tag, Petróleo like PASTA and ARQUIVO.
    await generate(page, OFFLINE, LOOSE);
    await levelIds(page);
    expect(await cardTags(page)).toContain("CÓDIGO SOLTO");
    seen.add("CÓDIGO SOLTO");

    await page.goto(`${OFFLINE}/`);
    await page.getByLabel("Caminho da pasta").fill(FIXTURE);
    await page.getByRole("button", { name: "Mapear pasta" }).click();
    const folders = await levelTags(page);
    // The top level holds the subfolders and the root files (PROJ-02).
    expect(folders).toEqual(["PASTA", "PASTA", "PASTA", "ARQUIVO", "ARQUIVO"]);
    for (const t of folders) seen.add(t);
    // Folders do not open in the side panel: PASTA, ARQUIVO and CÓDIGO SOLTO are Petróleo.
    const tagOf = (word: string) =>
      nodes(page).filter({ hasText: word }).first().locator(".tag");
    expect(await css(tagOf("PASTA"), "color")).toBe(MAIN);
    expect(await css(tagOf("ARQUIVO"), "color")).toBe(MAIN);
    await clickCard(page, "dir:pedidos");
    await expect(nodes(page)).toHaveCount(3);
    const files = await levelTags(page);
    expect(files).toEqual(["ARQUIVO", "ARQUIVO", "ARQUIVO"]);
    for (const t of files) seen.add(t);

    expect([...seen].sort()).toEqual([...TAGS].sort());
  });

  test("VID-05: wires are Petróleo 4 px curves", async ({ page }) => {
    // The video stage: the main flow fits on one row, so every wire is the plain curve.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    // Seven next wires and one calls wire (processar_pedido -> calcular_frete).
    await expect(edges(page)).toHaveCount(8);

    const wires = await page
      .locator(".react-flow__edge:not(.edge-calls) path.wire")
      .evaluateAll((els) =>
        els.map((el) => {
          const s = getComputedStyle(el);
          return {
            stroke: s.stroke,
            width: s.strokeWidth,
            fill: s.fill,
            d: el.getAttribute("d") ?? "",
          };
        }),
      );
    expect(wires).toHaveLength(7);
    for (const w of wires) {
      expect(w.stroke).toBe(MAIN);
      expect(w.width).toBe("4px");
      expect(w.fill).toBe("none");
      expect(w.d).toMatch(/^M [-\d.]+ [-\d.]+ C [-\d.]+ [-\d.]+, /);
    }
    // The calls wire is a dashed 3.5 px dependency wire, gray inside one file.
    const dep = page.locator(".edge-calls.reach-inside path.wire");
    await expect(dep).toHaveCount(1);
    expect(await css(dep, "stroke")).toBe("rgb(107, 112, 111)");
    expect(await css(dep, "stroke-width")).toBe("3.5px");
    expect(await css(dep, "stroke-dasharray")).not.toBe("none");
  });
});

test.describe("O editor", () => {
  test("VID-08: Colar trecho opens the editor panel: trecho in Petróleo, mono code, a Petróleo Gerar mapa and Início", async ({
    page,
  }) => {
    await page.goto(`${OFFLINE}/`);
    await page.getByRole("button", { name: /Colar trecho/ }).click();
    const editor = page.getByRole("region", { name: "Editor" });
    const file = editor.getByText("trecho", { exact: true });
    await expect(file).toBeVisible();
    expect(await css(file, "color")).toBe(MAIN);
    const code = page.getByLabel("Trecho de código");
    await expect(code).toBeVisible();
    expect(await css(code, "font-family")).toMatch(/^"DM Mono"/);
    const button = page.getByRole("button", { name: "Gerar mapa" });
    await expect(button).toBeVisible();
    expect(await css(button, "background-color")).toBe(MAIN);
    await expect(page.getByRole("button", { name: "Início" })).toBeVisible();
    // No map yet: no canvas and no "Novo código".
    await expect(canvas(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Novo código" })).toHaveCount(
      0,
    );
  });

  test("VID-09: Gerar mapa swaps the editor for a full-screen map; Novo código brings the same text back", async ({
    page,
  }) => {
    await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    await expect(page.getByLabel("Trecho de código")).toHaveCount(0);
    const newCode = page.getByRole("button", { name: "Novo código" });
    await expect(newCode).toBeVisible();
    const view = page.viewportSize();
    const map = await page.locator("main").boundingBox();
    expect(map).toEqual({
      x: 0,
      y: 0,
      width: view?.width,
      height: view?.height,
    });

    await newCode.click();
    await expect(page.getByLabel("Trecho de código")).toHaveValue(VIDEO);
    await expect(canvas(page)).toHaveCount(0);
    await expect(newCode).toHaveCount(0);
  });
});

/** "source->target" of each drawn wire, in DOM order. */
const wirePairs = (page: Page) =>
  edges(page).evaluateAll((els) =>
    els.map((el) =>
      (el.getAttribute("aria-label") ?? "")
        .replace(/^Aresta de /, "")
        .replace(" para ", "->"),
    ),
  );

/** Two top functions that nobody calls: two entries (VID-11). */
const TWO_ENTRIES = "def a():\n    print(1)\n\n\ndef b():\n    print(2)\n";
/** Loose code that calls a(), plus b that nobody calls; the constant is no entry (VID-11, 12). */
const LOOSE = `LIMITE = 10


def a():
    print(1)


def b():
    print(2)


a()
`;
/** Only constants at the top: the function is still the entry (VID-11). */
const CONSTANTS = "LIMITE = 10\nTAXA = 0.5\n\n\ndef a():\n    print(LIMITE)\n";

test.describe("O fluxo principal", () => {
  test("VID-10, IT P1: the video code shows its 9 cards in code order, joined by 7 next wires and 1 calls wire", async ({
    page,
  }) => {
    await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    expect(await cardTags(page)).toEqual([
      "FUNÇÃO",
      "EXTERNO",
      "EXTERNO",
      "BANCO",
      "FUNÇÃO",
      "EXTERNO",
      "BANCO",
      "E-MAIL",
      "FUNÇÃO",
    ]);
    await expect
      .poll(() => cardNames(page))
      .toEqual([
        "Processar pedido",
        "Loads",
        "Validar pedido",
        "Buscar cliente",
        "Calcular frete",
        "Soma itens",
        "Salvar",
        "Enviar email",
        "Calcular frete",
      ]);
    await expect(edges(page)).toHaveCount(8);
    // The next wires join the entry and its seven commands; the calls wire
    // joins the entry to the function it calls, which has no steps here.
    expect(await wirePairs(page)).toEqual([
      ...MAIN_FLOW.slice(1, -1).map((id, i) => `${MAIN_FLOW[i]}->${id}`),
      `${PEDIDO}->${FRETE}`,
    ]);
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "Fluxo principal",
    ]);
  });

  test("VID-10 edge: an entry with no call shows only its FUNÇÃO", async ({
    page,
  }) => {
    await generate(page, OFFLINE, "def vazio():\n    x = 1\n");
    await expectLevel(page, ["fn:vazio"]);
    expect(await cardTags(page)).toEqual(["FUNÇÃO"]);
    await expect(edges(page)).toHaveCount(0);
  });

  test("VID-11: each entry gets its own row, top to bottom in code order; constants are no entry", async ({
    page,
  }) => {
    await generate(page, OFFLINE, TWO_ENTRIES);
    await expectLevel(page, ["fn:a", "fn:a/s0", "fn:b", "fn:b/s0"]);
    expect(await cardTags(page)).toEqual([
      "FUNÇÃO",
      "EXTERNO",
      "FUNÇÃO",
      "EXTERNO",
    ]);
    expect(await wirePairs(page)).toEqual(["fn:a->fn:a/s0", "fn:b->fn:b/s0"]);
    const a = await box(cardOf(page, "fn:a"));
    const b = await box(cardOf(page, "fn:b"));
    expect(a.y + a.height).toBeLessThan(b.y);

    const graph = await generate(page, OFFLINE, LOOSE);
    const mod = graph.nodes.find((n) => n.kind === "module")?.id as string;
    expect(mod).toBeDefined();
    const call = graph.nodes.find(
      (n) => n.parentId === mod && n.kind === "call",
    )?.id as string;
    // a is called, so it shows as a card with no steps; b is an entry (VID-11).
    await expectLevel(page, [mod, call, "fn:a", "fn:b", "fn:b/s0"]);
    expect(await cardTags(page)).toEqual([
      "CÓDIGO SOLTO",
      "FUNÇÃO",
      "FUNÇÃO",
      "FUNÇÃO",
      "EXTERNO",
    ]);
    await expect
      .poll(() => cardNames(page))
      .toEqual(["Código solto", "A", "A", "B", "Print"]);
    const loose = await box(cardOf(page, mod));
    const second = await box(cardOf(page, "fn:b"));
    expect(loose.y + loose.height).toBeLessThan(second.y);

    await generate(page, OFFLINE, CONSTANTS);
    await expectLevel(page, ["fn:a", "fn:a/s0"]);
    expect(await cardNames(page)).toEqual(["A", "Print"]);
  });

  test("VID-12: no card on the first level says Módulo; loose code is the CÓDIGO SOLTO card", async ({
    page,
  }) => {
    const graph = await generate(page, OFFLINE, LOOSE);
    const mod = graph.nodes.find((n) => n.kind === "module")?.id as string;
    await expect(nodes(page)).toHaveCount(5);
    await levelIds(page);
    const texts = await nodes(page).allTextContents();
    expect(texts.filter((t) => t.includes("Módulo"))).toEqual([]);
    await expect(cardOf(page, mod).locator(".tag")).toHaveText("CÓDIGO SOLTO");
    await expect(cardOf(page, mod).locator(".name")).toHaveAttribute(
      "title",
      "Código solto",
    );
  });

  test("VID-13: undefined names get BANCO, E-MAIL or EXTERNO and no calls wire; only calcular_frete is called", async ({
    page,
  }) => {
    const graph = await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    const tagOf = (id: string) => cardOf(page, id).getAttribute("data-tag");
    expect(await tagOf(`${PEDIDO}/s1`)).toBe("EXTERNO");
    expect(await tagOf(`${PEDIDO}/s2`)).toBe("BANCO");
    expect(await tagOf(`${PEDIDO}/s5`)).toBe("BANCO");
    expect(await tagOf(`${PEDIDO}/s6`)).toBe("E-MAIL");
    await expect(cardOf(page, `${PEDIDO}/s1`).locator(".fn")).toHaveText(
      "validar_pedido()",
    );
    await expect(cardOf(page, `${PEDIDO}/s2`).locator(".fn")).toHaveText(
      "db.buscar_cliente()",
    );
    await expect(cardOf(page, `${PEDIDO}/s6`).locator(".fn")).toHaveText(
      "enviar_email()",
    );

    const byId = (id: string) => graph.nodes.find((n) => n.id === id);
    expect(byId(`${PEDIDO}/s1`)).toMatchObject({
      kind: "external",
      callee: "validar_pedido",
      category: "EXTERNO",
    });
    expect(byId(`${PEDIDO}/s2`)).toMatchObject({
      kind: "external",
      callee: "db.buscar_cliente",
      category: "BANCO",
    });
    expect(byId(`${PEDIDO}/s5`)).toMatchObject({
      kind: "external",
      callee: "db.salvar",
      category: "BANCO",
    });
    expect(byId(`${PEDIDO}/s6`)).toMatchObject({
      kind: "external",
      callee: "enviar_email",
      category: "EMAIL",
    });
    const calls = graph.edges.filter((e) => e.kind === "calls");
    expect(calls.map((e) => e.target)).toEqual([FRETE]);
  });
});

test.describe("O movimento", () => {
  test("VID-06: cards enter left to right, each wire draws after its source, one pulse per wire in flow order", async ({
    page,
  }) => {
    // The video stage: the main flow fits on one row.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);

    const cards = await nodes(page).evaluateAll((els) =>
      els.map((el) => {
        const card = el.querySelector(".node") as HTMLElement;
        const s = getComputedStyle(card);
        return {
          id: el.getAttribute("data-id") ?? "",
          x: el.getBoundingClientRect().x,
          y: el.getBoundingClientRect().y,
          enterAt: Number(card.getAttribute("data-enter-at")),
          delay: s.animationDelay,
          name: s.animationName,
        };
      }),
    );
    // The card the entry calls sits in its own row under the entry, so it enters
    // right after the entry (same x, lower y).
    const byX = [...cards].sort((a, b) => a.x - b.x || a.y - b.y);
    expect(byX.map((c) => c.id)).toEqual([
      PEDIDO,
      FRETE,
      ...MAIN_FLOW.slice(1, -1),
    ]);
    for (let i = 1; i < byX.length; i++) {
      expect(byX[i]?.enterAt).toBeGreaterThan(byX[i - 1]?.enterAt as number);
    }
    for (const c of cards) {
      expect(c.name).toBe("node-in");
      expect(Math.round(Number.parseFloat(c.delay) * 1000)).toBe(c.enterAt);
    }

    const enterAt = new Map(cards.map((c) => [c.id, c.enterAt]));
    // The calls wire has no draw-in and no pulse; the seven next wires have both.
    const callsWire = page.locator(".edge-calls");
    await expect(callsWire).toHaveCount(1);
    await expect(callsWire.locator("circle.pulse")).toHaveCount(0);
    const wires = await page
      .locator(
        '[aria-roledescription="edge"]:not(.edge-contains):not(.edge-calls)',
      )
      .evaluateAll((els) =>
        els.map((el) => ({
          pair: (el.getAttribute("aria-label") ?? "")
            .replace(/^Aresta de /, "")
            .split(" para "),
          drawAt: Number(
            el.querySelector(".wire")?.getAttribute("data-draw-at"),
          ),
          pulses: [...el.querySelectorAll("circle.pulse")].map((p) =>
            Number(p.getAttribute("data-pulse-at")),
          ),
        })),
      );
    expect(wires).toHaveLength(7);
    for (const w of wires) {
      const [source] = w.pair as [string, string];
      expect(w.drawAt).toBeGreaterThanOrEqual(
        (enterAt.get(source) as number) + 250,
      );
      expect(w.pulses).toHaveLength(1);
    }
    const inFlow = [...wires].sort(
      (a, b) =>
        (enterAt.get(a.pair[0] as string) as number) -
        (enterAt.get(b.pair[0] as string) as number),
    );
    for (let i = 1; i < inFlow.length; i++) {
      expect(inFlow[i]?.pulses[0]).toBeGreaterThan(
        inFlow[i - 1]?.pulses[0] as number,
      );
    }
    // Every pulse starts after the last wire is drawn: one dot runs at a time.
    const lastDraw = Math.max(...wires.map((w) => w.drawAt));
    expect(inFlow[0]?.pulses[0]).toBeGreaterThan(lastDraw);
  });

  test("VID-07: with reduced motion the level shows complete, with no animation and no pulse", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await generate(page, OFFLINE, VIDEO);
    await expect(nodes(page)).toHaveCount(9);
    await expect(nodes(page).first()).toBeVisible();
    const right = await page.evaluate(() => ({
      animations: document.getAnimations().length,
      opacities: [...document.querySelectorAll(".node")].map(
        (el) => getComputedStyle(el).opacity,
      ),
    }));
    expect(right).toEqual({
      animations: 0,
      opacities: MAIN_FLOW.map(() => "1"),
    });
    await expect(page.locator("circle.pulse")).toHaveCount(0);

    // Opening a node shows the inner level at once, with no growing frame.
    await clickCard(page, `${PEDIDO}/s3`);
    await expect(canvas(page)).toHaveAttribute("data-phase", "open");
    await expect(page.locator(".open-frame")).toHaveCount(0);
    await expectLevel(page, FRETE_LEVEL);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });
});
