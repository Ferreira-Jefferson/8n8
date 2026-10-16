import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Graph, ReviewStatus, Suggestion, Summary } from "@8n8/model";
import {
  expect,
  type Locator,
  type Page,
  type Route,
  test,
} from "@playwright/test";

// Feature 01-fatia-central, end to end: real build, real server, real parser.
// /api/summary and /api/suggestions are mocked only where a fake LLM answer is needed
// (no key, no network).
// Feature 05 moved it to the video map: the top level is the main flow ("Fluxo
// principal"), one click opens a node, and cards show a tag and a provisional name.

const VIDEO = readFileSync(
  new URL(
    "../packages/languages/python/src/__tests__/fixtures/pedido_frete.py",
    import.meta.url,
  ),
  "utf8",
).replace(/\r\n/g, "\n");
const VIDEO_LINES = VIDEO.split("\n");
/**
 * The video snippet where processar_pedido calls another name, so calcular_frete
 * is an entry and its card shows on the main flow (VID-11). Lines 1..13 are
 * unchanged, so the mocked explanation of calcular_frete (lines 4..11) still fits.
 */
const TWO_ENTRIES = VIDEO.replace("calcular_frete(item", "frete_do_item(item");

const FRETE = "fn:calcular_frete";
const PEDIDO = "fn:processar_pedido";
/** The loop of processar_pedido, the only call command of its body (VID-10). */
const LOOP = `${PEDIDO}/s1`;

function shot(page: Page, name: string): Promise<Buffer> {
  const path = fileURLToPath(
    new URL(`./__screenshots__/${name}.png`, import.meta.url),
  );
  return page.screenshot({ path, fullPage: true });
}

const canvas = (page: Page) => page.getByRole("application");
const nodes = (page: Page) =>
  canvas(page).locator('[aria-roledescription="node"]:not(.hub-node)');
const edges = (page: Page) =>
  canvas(page).locator('[aria-roledescription="edge"]:not(.edge-contains)');
const nodeById = (page: Page, id: string) =>
  canvas(page).locator(`[aria-roledescription="node"][data-id="${id}"]`);
const edge = (page: Page, from: string, to: string) =>
  canvas(page).getByRole("group", { name: `Aresta de ${from} para ${to}` });
const breadcrumb = (page: Page) =>
  page.getByRole("navigation", { name: "Caminho de navegação" });
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Detalhe do nó" });

/** The card titles of the level, without the "›" open mark, in DOM order (VID-03, 15). */
const cardNames = (page: Page) =>
  nodes(page).evaluateAll((els) =>
    els.map((el) => el.querySelector(".name")?.firstChild?.textContent ?? null),
  );
/** The "Entrada e saída" line as read, without the evidence buttons (VID-30). */
const ioLine = (view: Locator) =>
  view.getByLabel("Entrada e saída").evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const b of copy.querySelectorAll("button")) b.remove();
    return copy.textContent;
  });
/** The tag of each card of the level (VID-04). */
const cardTags = (page: Page) =>
  nodes(page).evaluateAll((els) =>
    els.map((el) => el.querySelector("[data-tag]")?.getAttribute("data-tag")),
  );

/** Texts of the summary sentences, one per item of the "Resumo" list. */
const summaryItems = (view: Locator) =>
  view.getByRole("list", { name: "Resumo" }).locator(":scope > li > span");
/** Suggestion buttons: "<comando> (linha N, <severidade>)". */
const suggestionButtons = (view: Locator) =>
  view
    .getByRole("heading", { name: "Sugestões", exact: true })
    .locator("xpath=following-sibling::ul[1]")
    .getByRole("button", { name: /\(linha \d+, / });

/** Generates the map and returns the graph the server sent. */
async function generate(page: Page, source: string): Promise<Graph> {
  await page.goto("/");
  await page.getByRole("button", { name: /Colar trecho/ }).click();
  await page.getByLabel("Trecho de código").fill(source);
  const response = page.waitForResponse("**/api/graph");
  await page.getByRole("button", { name: "Gerar mapa" }).click();
  return ((await response).json() as Promise<{ graph: Graph }>).then(
    (body) => body.graph,
  );
}

/**
 * Clicks a card even when the zoom leaves it off-screen. It must be visible
 * first: a click never reaches a card the user cannot see.
 */
async function clickCard(page: Page, id: string): Promise<void> {
  const card = nodeById(page, id);
  await expect(card).toBeVisible();
  await card.dispatchEvent("click");
}

/** From the main flow, through the loop and its call, into calcular_frete (VID-23, 24). */
async function openFrete(page: Page): Promise<void> {
  await clickCard(page, LOOP);
  await clickCard(page, `${LOOP}/s0`);
  await expect(nodeById(page, `${FRETE}/s0`)).toHaveCount(1);
}

async function nodeIds(page: Page): Promise<(string | null)[]> {
  return nodes(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-id")),
  );
}

/** A node's whole explanation, as the fixtures write it; the server answers it in two parts. */
interface Explanation extends Summary {
  suggestions: Suggestion[];
}

type Body =
  | {
      status: "ok";
      explanation: Explanation;
      fromCache: boolean;
      review: ReviewStatus;
    }
  | { status: "error"; message: string };
type Reply = { status: 200 | 502; body: Body };

/**
 * Answers /api/summary and /api/suggestions with the server's own shapes; `nth`
 * counts summary calls per node. The suggestions of a failed reply are an empty
 * list, so the panel shows one failure, the summary's.
 */
async function mockExplain(
  page: Page,
  reply: (nodeId: string, nth: number) => Reply,
): Promise<string[]> {
  const calls: string[] = [];
  await page.route("**/api/summary", async (route: Route) => {
    const { nodeId } = route.request().postDataJSON() as { nodeId: string };
    const nth = calls.filter((id) => id === nodeId).length;
    calls.push(nodeId);
    const { status, body } = reply(nodeId, nth);
    if (body.status !== "ok") return route.fulfill({ status, json: body });
    const { suggestions: _, ...summary } = body.explanation;
    await route.fulfill({
      status,
      json: { ...body, explanation: undefined, result: summary },
    });
  });
  await page.route("**/api/suggestions", async (route: Route) => {
    const { nodeId } = route.request().postDataJSON() as { nodeId: string };
    const nth = Math.max(0, calls.filter((id) => id === nodeId).length - 1);
    const { body } = reply(nodeId, nth);
    await route.fulfill({
      status: 200,
      json: {
        status: "ok",
        result: body.status === "ok" ? body.explanation.suggestions : [],
        fromCache: body.status === "ok" && body.fromCache,
        review: "full",
      },
    });
  });
  return calls;
}

// Lines are absolute: the server already moved them into the node (4..11).
const FRETE_SUMMARY =
  "Calcula o frete do pedido a partir do peso e da distância.";
const FRETE_EXPLANATION: Explanation = {
  summary: FRETE_SUMMARY,
  sentences: [{ id: "s1", text: FRETE_SUMMARY, lines: [4, 5, 6, 7] }],
  inputs: [
    { id: "i1", text: "peso", lines: [4] },
    { id: "i2", text: "distancia", lines: [4] },
  ],
  outputs: [{ id: "o1", text: "valor do frete", lines: [9, 11] }],
  suggestions: [
    {
      id: "g1",
      command: "Guardar a tabela de frete em cache",
      reason: "A função busca a tabela na rede a cada chamada.",
      line: 5,
      severity: "media",
      lines: [5],
    },
    {
      id: "g2",
      command: "Dar nome ao limite de peso",
      reason: "O número 30 aparece sem explicação.",
      line: 8,
      severity: "baixa",
      lines: [8],
    },
  ],
};
const PEDIDO_SUMMARY = "Soma o frete de cada item.";
const PEDIDO_EXPLANATION: Explanation = {
  summary: PEDIDO_SUMMARY,
  sentences: [{ id: "s1", text: PEDIDO_SUMMARY, lines: [15, 16, 17, 18] }],
  inputs: [{ id: "i1", text: "itens", lines: [14] }],
  outputs: [{ id: "o1", text: "total", lines: [18] }],
  suggestions: [],
};
const ok = (explanation: Explanation, fromCache = false): Reply => ({
  status: 200,
  body: { status: "ok", explanation, fromCache, review: "full" },
});
const failure: Reply = {
  status: 502,
  body: { status: "error", message: "OpenRouter respondeu 500" },
};

test.describe("Mapa", () => {
  test("CORE-01/02, IT 1: the video snippet gives two nodes and one wire", async ({
    page,
  }) => {
    const graph = await generate(page, VIDEO);

    // CORE-01/02 in the graph: each function is a node, joined by a calls wire.
    expect(
      graph.nodes.filter((n) => n.parentId === null).map((n) => n.id),
    ).toEqual([FRETE, PEDIDO]);
    expect(
      graph.edges
        .filter((e) => e.kind === "calls")
        .map((e) => `${e.source}->${e.target}`),
    ).toEqual([`${PEDIDO}->${FRETE}`]);

    // The main flow draws the entry, its call command and the function it calls,
    // joined by one next wire and one calls wire (VID-10).
    await expect(nodes(page)).toHaveCount(3);
    expect(await nodeIds(page)).toEqual([FRETE, PEDIDO, LOOP]);
    await expect
      .poll(() => cardNames(page))
      .toEqual(["Calcular frete", "Processar pedido", "for item in itens"]);
    expect(await cardTags(page)).toEqual(["FUNÇÃO", "FUNÇÃO", "LAÇO"]);
    await expect(edges(page)).toHaveCount(2);
    await expect(edge(page, PEDIDO, LOOP)).toHaveCount(1);
    await expect(edge(page, PEDIDO, FRETE)).toHaveCount(1);
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "Fluxo principal",
    ]);
    await shot(page, "01-top-level");
  });

  test("CORE-03: loose statements become one Código solto node", async ({
    page,
  }) => {
    await generate(
      page,
      [
        "import os",
        "",
        "LIMITE = 30",
        "print(LIMITE)",
        "",
        "",
        "def f():",
        "    return 1",
        "",
      ].join("\n"),
    );

    // Two entries (VID-11): the loose code with its print call, and f.
    await expect(nodes(page)).toHaveCount(3);
    expect(await nodeIds(page)).toEqual(["mod", "mod/s1", "fn:f"]);
    await expect
      .poll(() => cardNames(page))
      .toEqual(["Código solto", "Print", "F"]);
    expect(await cardTags(page)).toEqual(["CÓDIGO SOLTO", "EXTERNO", "FUNÇÃO"]);
    await expect(canvas(page).getByText("Módulo")).toHaveCount(0);
  });

  test("CORE-04: the same snippet gives the same node IDs", async ({
    page,
  }) => {
    await generate(page, VIDEO);
    await expect(nodes(page)).toHaveCount(3);
    const first = await nodeIds(page);

    await page.getByRole("button", { name: "Novo código" }).click();
    await page.getByRole("button", { name: "Gerar mapa" }).click();
    await expect(nodes(page)).toHaveCount(3);

    expect(first).toEqual([FRETE, PEDIDO, LOOP]);
    expect(await nodeIds(page)).toEqual(first);
  });

  test("CORE-05: generating the map makes no explain request", async ({
    page,
  }) => {
    const explainCalls: string[] = [];
    page.on("request", (r) => {
      if (/\/api\/(summary|suggestions)$/.test(r.url())) {
        explainCalls.push(r.url());
      }
    });

    await generate(page, VIDEO);
    await expect(nodes(page)).toHaveCount(3);

    expect(explainCalls).toEqual([]);
  });

  test("CORE-06: a syntax error keeps the valid parts and marks the node", async ({
    page,
  }) => {
    await generate(
      page,
      ["def a():", "    pass", "", "", "def b(:", "    pass", ""].join("\n"),
    );

    await expect(nodes(page)).toHaveCount(2);
    await expect.poll(() => cardNames(page)).toEqual(["A", "B"]);
    await expect(page.getByText(/^Erro de sintaxe na linha \d+$/)).toHaveCount(
      1,
    );
    await expect(
      nodeById(page, "fn:b").getByText("Erro de sintaxe na linha 5", {
        exact: true,
      }),
    ).toHaveCount(1);
    await shot(page, "02-syntax-error");
  });

  test("CORE-07: an empty snippet shows the empty message", async ({
    page,
  }) => {
    await generate(page, "");

    await expect(
      page.getByText("Nenhuma função ou instrução encontrada.", {
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(nodes(page)).toHaveCount(0);

    await page.getByLabel("Trecho de código").fill("# só um comentário\n");
    await page.getByRole("button", { name: "Gerar mapa" }).click();
    await expect(
      page.getByText("Nenhuma função ou instrução encontrada.", {
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(nodes(page)).toHaveCount(0);
    await shot(page, "03-empty");
  });
});

test.describe("Drill-down", () => {
  test("CORE-08/09/12/13, IT 2: calcular_frete opens to HTTP → Código → condition with true/false", async ({
    page,
  }) => {
    const graph = await generate(page, VIDEO);
    await openFrete(page);

    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "Fluxo principal",
      "for item in itens",
      "Calcular frete",
    ]);
    await expect(nodes(page)).toHaveCount(5);
    await expect
      .poll(() => cardNames(page))
      .toEqual(["Get", "Código", "peso > 30", "Retorno", "Retorno"]);
    expect(await cardTags(page)).toEqual([
      "HTTP",
      "CÓDIGO",
      "SE",
      "RETORNO",
      "RETORNO",
    ]);

    await expect(edges(page)).toHaveCount(4);
    await expect(edge(page, `${FRETE}/s0`, `${FRETE}/s1`)).toHaveCount(1);
    await expect(edge(page, `${FRETE}/s1`, `${FRETE}/s2`)).toHaveCount(1);
    await expect(edge(page, `${FRETE}/s2`, `${FRETE}/s2/b0/s0`)).toHaveCount(1);
    await expect(edge(page, `${FRETE}/s2`, `${FRETE}/s2/b1/s0`)).toHaveCount(1);
    // The labels sit outside the edge group; the graph ties each one to its wire.
    const branch = (to: string) =>
      graph.edges.find((e) => e.source === `${FRETE}/s2` && e.target === to)
        ?.label;
    expect(branch(`${FRETE}/s2/b0/s0`)).toBe("true");
    expect(branch(`${FRETE}/s2/b1/s0`)).toBe("false");
    await expect(canvas(page).locator("[data-branch-label]")).toHaveText([
      "true",
      "false",
    ]);

    // Code order reads like text: left to right, and a level too wide for the
    // canvas wraps into a lower row that starts again at the left (design C7).
    const at = async (id: string) => {
      const b = await nodeById(page, id).boundingBox();
      return b ?? { x: Number.NaN, y: Number.NaN, height: Number.NaN };
    };
    const steps = [
      await at(`${FRETE}/s0`),
      await at(`${FRETE}/s1`),
      await at(`${FRETE}/s2`),
    ];
    for (let i = 1; i < steps.length; i++) {
      const a = steps[i - 1] as { x: number; y: number; height: number };
      const b = steps[i] as { x: number; y: number; height: number };
      const sameRow = Math.abs(a.y - b.y) < a.height;
      if (sameRow) expect(b.x).toBeGreaterThan(a.x);
      else expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
    }
    await shot(page, "04-calcular-frete");
  });

  test("CORE-10/11/15: loop → call → called function, then back through the breadcrumb", async ({
    page,
  }) => {
    await generate(page, VIDEO);
    await clickCard(page, PEDIDO);
    await expect(nodes(page)).toHaveCount(3);
    await expect
      .poll(() => cardNames(page))
      .toEqual(["Código", "for item in itens", "Retorno"]);

    await clickCard(page, `${PEDIDO}/s1`);
    await expect(nodes(page)).toHaveCount(1);
    await expect.poll(() => cardNames(page)).toEqual(["Calcular frete"]);

    await clickCard(page, `${PEDIDO}/s1/s0`);
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "Fluxo principal",
      "Processar pedido",
      "for item in itens",
      "Calcular frete",
    ]);
    await expect(nodes(page)).toHaveCount(5);
    await expect(
      nodeById(page, `${FRETE}/s2`).locator(".name"),
    ).toHaveAttribute("title", "peso > 30");
    await shot(page, "05-breadcrumb-deep");

    await breadcrumb(page)
      .getByRole("button", { name: "Processar pedido" })
      .click();
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "Fluxo principal",
      "Processar pedido",
    ]);
    await expect(nodes(page)).toHaveCount(3);

    await breadcrumb(page)
      .getByRole("button", { name: "Fluxo principal" })
      .click();
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "Fluxo principal",
    ]);
    await expect(nodes(page)).toHaveCount(3);
    await expect(edge(page, PEDIDO, LOOP)).toHaveCount(1);
  });

  test("CORE-14, IT 3: selecting the HTTP node shows the requests.get line", async ({
    page,
  }) => {
    await generate(page, VIDEO);
    await openFrete(page);
    await clickCard(page, `${FRETE}/s0`);

    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(
      "Get",
    );
    await expect(panel(page).getByText(/^CÓDIGO · /)).toHaveText(
      "CÓDIGO · trecho.py, linha 5",
    );
    await expect(panel(page).locator("[data-line]")).toHaveCount(1);
    await expect(panel(page).locator("[data-line]")).toHaveText([
      `5${VIDEO_LINES[4]}`,
    ]);
    await expect(panel(page).locator("code")).toHaveText([
      '    requests.get("https://api.exemplo.com/tabela-frete")',
    ]);
    await shot(page, "06-http-selected");
  });

  test("CORE-14: selecting a function shows its exact lines", async ({
    page,
  }) => {
    await generate(page, VIDEO);
    // The call card shows the panel of the function it calls (VID-24).
    await openFrete(page);

    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(
      "Calcular frete",
    );
    await expect(panel(page).getByText(/^CÓDIGO · /)).toHaveText(
      "CÓDIGO · trecho.py, linhas 4 a 11",
    );
    await expect(panel(page).locator("code")).toHaveText(
      VIDEO_LINES.slice(3, 11),
    );
  });
});

test.describe("Explicação", () => {
  test("CORE-19: with no key the real server answers no-key and the map stays", async ({
    page,
  }) => {
    await generate(page, VIDEO);
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/summary") &&
        (r.request().postDataJSON() as { nodeId: string }).nodeId === FRETE,
    );
    await openFrete(page);

    const res = await response;
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "no-key" });
    // Both parts say it: the summary and the suggestions (CFG-09).
    await expect(
      panel(page).getByText("Configure um provedor de LLM em Configurações.", {
        exact: true,
      }),
    ).toHaveCount(2);
    await expect(nodes(page)).toHaveCount(5);
    await expect(edges(page)).toHaveCount(4);
    await shot(page, "07-no-key");
  });

  test("CORE-16/23/24: one call per opening, badge with the count, suggestion marks its line", async ({
    page,
  }) => {
    const calls = await mockExplain(page, (id) =>
      ok(id === FRETE ? FRETE_EXPLANATION : PEDIDO_EXPLANATION),
    );
    await generate(page, TWO_ENTRIES);
    await clickCard(page, FRETE);

    const view = panel(page);
    await expect(summaryItems(view)).toHaveText([FRETE_SUMMARY]);
    // VID-30: the inputs, an arrow and the outputs, in one line.
    await expect
      .poll(() => ioLine(view))
      .toBe("peso, distancia → valor do frete");
    const suggestions = suggestionButtons(view);
    await expect(suggestions).toHaveText([
      "Guardar a tabela de frete em cache (linha 5, média)",
      "Dar nome ao limite de peso (linha 8, baixa)",
    ]);
    expect(calls).toEqual([FRETE]);

    // Opening shows the inside of calcular_frete; the badge sits on its card above.
    await page.keyboard.press("Escape");
    // Each suggestion goes to the visible node that holds its line: line 5 to
    // the requests.get step, line 8 to calcular_frete itself.
    await expect(nodeById(page, FRETE).locator(".step-badge")).toHaveText("1");
    await expect(canvas(page).locator(".step-badge")).toHaveText(["1", "1"]);
    await expect(nodeById(page, PEDIDO).locator(".step-badge")).toHaveCount(0);

    await expect(view.locator('[aria-current="true"]')).toHaveCount(0);
    await view
      .getByRole("button", {
        name: "Guardar a tabela de frete em cache (linha 5, média)",
        exact: true,
      })
      .click();
    await expect(view.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(view.locator('[aria-current="true"]')).toHaveAttribute(
      "data-line",
      "5",
    );
    await shot(page, "08-suggestion-line-5");

    await view
      .getByRole("button", {
        name: "Dar nome ao limite de peso (linha 8, baixa)",
        exact: true,
      })
      .click();
    await expect(view.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(view.locator('[aria-current="true"]')).toHaveAttribute(
      "data-line",
      "8",
    );
    expect(calls).toEqual([FRETE]);
  });

  test("CORE-18, IT 5 (UI side): reopening shows the cached answer unchanged", async ({
    page,
  }) => {
    const calls = await mockExplain(page, (id, nth) =>
      id === FRETE ? ok(FRETE_EXPLANATION, nth > 0) : ok(PEDIDO_EXPLANATION),
    );
    const fromCache: boolean[] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/api/summary")) {
        const body = (await r.json()) as { fromCache?: boolean };
        fromCache.push(body.fromCache === true);
      }
    });
    await generate(page, TWO_ENTRIES);

    await clickCard(page, FRETE);
    await expect(summaryItems(panel(page))).toHaveText([FRETE_SUMMARY]);
    await page.keyboard.press("Escape");
    await clickCard(page, PEDIDO);
    await expect(summaryItems(panel(page))).toHaveText([PEDIDO_SUMMARY]);
    await page.keyboard.press("Escape");
    await clickCard(page, FRETE);

    await expect(summaryItems(panel(page))).toHaveText([FRETE_SUMMARY]);
    await expect(suggestionButtons(panel(page))).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(canvas(page).locator(".step-badge")).toHaveText(["1", "1"]);
    // Within a map the app keeps the answer in memory: no new request.
    expect(calls).toEqual([FRETE, PEDIDO]);

    // A new map asks the server again, and its disk cache answers.
    await generate(page, TWO_ENTRIES);
    await clickCard(page, FRETE);
    await expect(summaryItems(panel(page))).toHaveText([FRETE_SUMMARY]);
    await expect(suggestionButtons(panel(page))).toHaveCount(2);
    expect(calls).toEqual([FRETE, PEDIDO, FRETE]);
    await expect.poll(() => fromCache).toEqual([false, false, true]);
  });

  test("CORE-20: a failed call shows Resumo indisponível, the map keeps working, retry recovers", async ({
    page,
  }) => {
    const calls = await mockExplain(page, (id, nth) =>
      id === FRETE && nth >= 2 ? ok(FRETE_EXPLANATION) : failure,
    );
    await generate(page, TWO_ENTRIES);
    await clickCard(page, FRETE);

    await expect(
      panel(page).getByText("Resumo indisponível", { exact: true }),
    ).toHaveCount(1);
    await expect(
      panel(page).getByRole("button", { name: "Tentar de novo" }),
    ).toHaveCount(1);
    await shot(page, "09-explain-error");

    // The map is still usable: go back, drill down and come back.
    await page.keyboard.press("Escape");
    await expect(nodes(page)).toHaveCount(4);
    await clickCard(page, PEDIDO);
    await expect(nodes(page)).toHaveCount(3);
    await breadcrumb(page)
      .getByRole("button", { name: "Fluxo principal" })
      .click();
    await expect(nodes(page)).toHaveCount(4);

    await clickCard(page, FRETE);
    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(
      "Calcular frete",
    );
    await expect(
      panel(page).getByText("Resumo indisponível", { exact: true }),
    ).toHaveCount(1);
    await panel(page).getByRole("button", { name: "Tentar de novo" }).click();

    await expect(summaryItems(panel(page))).toHaveText([FRETE_SUMMARY]);
    await expect(panel(page).getByText("Resumo indisponível")).toHaveCount(0);
    expect(calls.filter((id) => id === FRETE)).toHaveLength(3);
  });
});
