import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExplainResponse, Explanation } from "@code2n8n/model";
import { expect, type Page, type Route, test } from "@playwright/test";

// Feature 01-fatia-central, end to end: real build, real server, real parser.
// /api/explain is mocked only where a fake LLM answer is needed (no key, no network).

const VIDEO = readFileSync(
  new URL(
    "../packages/extract-python/src/__tests__/fixtures/pedido_frete.py",
    import.meta.url,
  ),
  "utf8",
).replace(/\r\n/g, "\n");
const VIDEO_LINES = VIDEO.split("\n");

const FRETE = "fn:calcular_frete";
const PEDIDO = "fn:processar_pedido";

function shot(page: Page, name: string): Promise<Buffer> {
  const path = fileURLToPath(
    new URL(`./__screenshots__/${name}.png`, import.meta.url),
  );
  return page.screenshot({ path, fullPage: true });
}

const canvas = (page: Page) => page.getByRole("application");
const nodes = (page: Page) =>
  canvas(page).locator('[aria-roledescription="node"]');
const edges = (page: Page) =>
  canvas(page).locator('[aria-roledescription="edge"]');
const nodeById = (page: Page, id: string) =>
  canvas(page).locator(`[aria-roledescription="node"][data-id="${id}"]`);
const edge = (page: Page, from: string, to: string) =>
  canvas(page).getByRole("group", { name: `Edge from ${from} to ${to}` });
const breadcrumb = (page: Page) =>
  page.getByRole("navigation", { name: "Caminho de navegação" });
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Detalhe do nó" });

async function generate(page: Page, source: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Trecho Python").fill(source);
  await page.getByRole("button", { name: "Gerar mapa" }).click();
}

async function nodeIds(page: Page): Promise<(string | null)[]> {
  return nodes(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-id")),
  );
}

type Reply = { status: 200 | 502; body: ExplainResponse };

/** Answers /api/explain with the server's own shapes; `nth` counts calls per node. */
async function mockExplain(
  page: Page,
  reply: (nodeId: string, nth: number) => Reply,
): Promise<string[]> {
  const calls: string[] = [];
  await page.route("**/api/explain", async (route: Route) => {
    const { nodeId } = route.request().postDataJSON() as { nodeId: string };
    const nth = calls.filter((id) => id === nodeId).length;
    calls.push(nodeId);
    const { status, body } = reply(nodeId, nth);
    await route.fulfill({ status, json: body });
  });
  return calls;
}

// Lines are absolute: the server already moved them into the node (4..11).
const FRETE_EXPLANATION: Explanation = {
  summary: "Calcula o frete do pedido a partir do peso e da distância.",
  inputs: ["peso", "distancia"],
  outputs: ["valor do frete"],
  suggestions: [
    {
      command: "Guardar a tabela de frete em cache",
      reason: "A função busca a tabela na rede a cada chamada.",
      line: 5,
      severity: "media",
    },
    {
      command: "Dar nome ao limite de peso",
      reason: "O número 30 aparece sem explicação.",
      line: 8,
      severity: "baixa",
    },
  ],
};
const PEDIDO_EXPLANATION: Explanation = {
  summary: "Soma o frete de cada item.",
  inputs: ["itens"],
  outputs: ["total"],
  suggestions: [],
};
const ok = (explanation: Explanation, fromCache = false): Reply => ({
  status: 200,
  body: { status: "ok", explanation, fromCache },
});
const failure: Reply = {
  status: 502,
  body: { status: "error", message: "OpenRouter respondeu 500" },
};

test.describe("Mapa", () => {
  test("CORE-01/02, IT 1: the video snippet gives two nodes and one wire", async ({
    page,
  }) => {
    await generate(page, VIDEO);

    await expect(nodes(page)).toHaveCount(2);
    await expect(nodes(page).locator(".step-label")).toHaveText([
      "calcular_frete",
      "processar_pedido",
    ]);
    await expect(edges(page)).toHaveCount(1);
    await expect(edge(page, PEDIDO, FRETE)).toHaveCount(1);
    await expect(breadcrumb(page).getByRole("button")).toHaveText(["Trecho"]);
    await shot(page, "01-top-level");
  });

  test("CORE-03: loose statements become one Módulo node", async ({ page }) => {
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

    await expect(nodes(page)).toHaveCount(2);
    await expect(nodes(page).locator(".step-label")).toHaveText([
      "Módulo",
      "f",
    ]);
  });

  test("CORE-04: the same snippet gives the same node IDs", async ({
    page,
  }) => {
    await generate(page, VIDEO);
    await expect(nodes(page)).toHaveCount(2);
    const first = await nodeIds(page);

    await page.getByRole("button", { name: "Gerar mapa" }).click();
    await expect(nodes(page)).toHaveCount(2);

    expect(first).toEqual([FRETE, PEDIDO]);
    expect(await nodeIds(page)).toEqual(first);
  });

  test("CORE-05: generating the map makes no explain request", async ({
    page,
  }) => {
    const explainCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/explain")) explainCalls.push(r.url());
    });

    await generate(page, VIDEO);
    await expect(nodes(page)).toHaveCount(2);

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
    await expect(nodes(page).locator(".step-label")).toHaveText(["a", "b"]);
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

    await page.getByLabel("Trecho Python").fill("# só um comentário\n");
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
  test("CORE-08/09/12/13, IT 2: calcular_frete opens to HTTP → Código → condition with sim/não", async ({
    page,
  }) => {
    await generate(page, VIDEO);
    await nodeById(page, FRETE).dblclick();

    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "Trecho",
      "calcular_frete",
    ]);
    await expect(nodes(page)).toHaveCount(5);
    await expect(nodes(page).locator(".step-label")).toHaveText([
      "requests.get",
      "Código",
      "peso > 30",
      "Código",
      "Código",
    ]);
    const http = nodeById(page, `${FRETE}/s0`);
    await expect(http.locator(".step-category")).toHaveText("HTTP");

    await expect(edges(page)).toHaveCount(4);
    await expect(edge(page, `${FRETE}/s0`, `${FRETE}/s1`)).toHaveCount(1);
    await expect(edge(page, `${FRETE}/s1`, `${FRETE}/s2`)).toHaveCount(1);
    await expect(edge(page, `${FRETE}/s2`, `${FRETE}/s2/b0/s0`)).toHaveText(
      "sim",
    );
    await expect(edge(page, `${FRETE}/s2`, `${FRETE}/s2/b1/s0`)).toHaveText(
      "não",
    );

    // Code order reads left to right.
    const x = async (id: string) =>
      (await nodeById(page, id).boundingBox())?.x ?? Number.NaN;
    const xs = [
      await x(`${FRETE}/s0`),
      await x(`${FRETE}/s1`),
      await x(`${FRETE}/s2`),
    ];
    expect(xs[0]).toBeLessThan(xs[1] ?? Number.NaN);
    expect(xs[1]).toBeLessThan(xs[2] ?? Number.NaN);
    await shot(page, "04-calcular-frete");
  });

  test("CORE-10/11/15: loop → call → called function, then back through the breadcrumb", async ({
    page,
  }) => {
    await generate(page, VIDEO);
    await nodeById(page, PEDIDO).dblclick();
    await expect(nodes(page).locator(".step-label")).toHaveText([
      "Código",
      "for item in itens",
      "Código",
    ]);

    await nodeById(page, `${PEDIDO}/s1`).dblclick();
    await expect(nodes(page).locator(".step-label")).toHaveText([
      "calcular_frete",
    ]);

    await nodeById(page, `${PEDIDO}/s1/s0`).dblclick();
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "Trecho",
      "processar_pedido",
      "for item in itens",
      "calcular_frete",
    ]);
    await expect(nodes(page)).toHaveCount(5);
    await expect(
      nodeById(page, `${FRETE}/s2`).locator(".step-label"),
    ).toHaveText("peso > 30");
    await shot(page, "05-breadcrumb-deep");

    await breadcrumb(page)
      .getByRole("button", { name: "processar_pedido" })
      .click();
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "Trecho",
      "processar_pedido",
    ]);
    await expect(nodes(page)).toHaveCount(3);

    await breadcrumb(page).getByRole("button", { name: "Trecho" }).click();
    await expect(breadcrumb(page).getByRole("button")).toHaveText(["Trecho"]);
    await expect(nodes(page)).toHaveCount(2);
    await expect(edge(page, PEDIDO, FRETE)).toHaveCount(1);
  });

  test("CORE-14, IT 3: selecting the HTTP node shows the requests.get line", async ({
    page,
  }) => {
    await generate(page, VIDEO);
    await nodeById(page, FRETE).dblclick();
    await nodeById(page, `${FRETE}/s0`).click();

    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(
      "requests.get",
    );
    await expect(panel(page).getByText(/^Linhas /)).toHaveText("Linhas 5–5");
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
    await nodeById(page, FRETE).click();

    await expect(panel(page).getByText(/^Linhas /)).toHaveText("Linhas 4–11");
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
    const response = page.waitForResponse("**/api/explain");
    await nodeById(page, FRETE).click();

    const res = await response;
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "no-key" });
    await expect(
      panel(page).getByText("Configure OPENROUTER_API_KEY para ver resumos", {
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(nodes(page)).toHaveCount(2);
    await expect(edges(page)).toHaveCount(1);
    await shot(page, "07-no-key");
  });

  test("CORE-16/23/24: one call per opening, badge with the count, suggestion marks its line", async ({
    page,
  }) => {
    const calls = await mockExplain(page, (id) =>
      ok(id === FRETE ? FRETE_EXPLANATION : PEDIDO_EXPLANATION),
    );
    await generate(page, VIDEO);
    await nodeById(page, FRETE).click();

    const view = panel(page);
    await expect(
      view.getByText(FRETE_EXPLANATION.summary, { exact: true }),
    ).toHaveCount(1);
    await expect(
      view.getByRole("list").nth(0).getByRole("listitem"),
    ).toHaveText(["peso", "distancia"]);
    await expect(
      view.getByRole("list").nth(1).getByRole("listitem"),
    ).toHaveText(["valor do frete"]);
    const suggestions = view.getByRole("list").nth(2).getByRole("button");
    await expect(suggestions).toHaveText([
      "Guardar a tabela de frete em cache (linha 5, media)",
      "Dar nome ao limite de peso (linha 8, baixa)",
    ]);
    expect(calls).toEqual([FRETE]);

    await expect(nodeById(page, FRETE).getByTitle("Sugestões")).toHaveText("2");
    await expect(nodeById(page, PEDIDO).getByTitle("Sugestões")).toHaveCount(0);

    await expect(view.locator('[aria-current="true"]')).toHaveCount(0);
    await suggestions.nth(0).click();
    await expect(view.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(view.locator('[aria-current="true"]')).toHaveAttribute(
      "data-line",
      "5",
    );
    await shot(page, "08-suggestion-line-5");

    await suggestions.nth(1).click();
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
      if (r.url().includes("/api/explain")) {
        const body = (await r.json()) as { fromCache?: boolean };
        fromCache.push(body.fromCache === true);
      }
    });
    await generate(page, VIDEO);

    await nodeById(page, FRETE).click();
    await expect(
      panel(page).getByText(FRETE_EXPLANATION.summary, { exact: true }),
    ).toHaveCount(1);
    await nodeById(page, PEDIDO).click();
    await expect(
      panel(page).getByText(PEDIDO_EXPLANATION.summary, { exact: true }),
    ).toHaveCount(1);
    await nodeById(page, FRETE).click();

    await expect(
      panel(page).getByText(FRETE_EXPLANATION.summary, { exact: true }),
    ).toHaveCount(1);
    await expect(
      panel(page).getByRole("list").nth(2).getByRole("button"),
    ).toHaveCount(2);
    await expect(nodeById(page, FRETE).getByTitle("Sugestões")).toHaveText("2");
    expect(calls).toEqual([FRETE, PEDIDO, FRETE]);
    await expect.poll(() => fromCache).toEqual([false, false, true]);
  });

  test("CORE-20: a failed call shows Resumo indisponível, the map keeps working, retry recovers", async ({
    page,
  }) => {
    const calls = await mockExplain(page, (id, nth) =>
      id === FRETE && nth >= 2 ? ok(FRETE_EXPLANATION) : failure,
    );
    await generate(page, VIDEO);
    await nodeById(page, FRETE).click();

    await expect(
      panel(page).getByText("Resumo indisponível", { exact: true }),
    ).toHaveCount(1);
    await expect(
      panel(page).getByRole("button", { name: "Tentar de novo" }),
    ).toHaveCount(1);
    await shot(page, "09-explain-error");

    // The map is still usable: drill down and come back.
    await nodeById(page, PEDIDO).dblclick();
    await expect(nodes(page)).toHaveCount(3);
    await breadcrumb(page).getByRole("button", { name: "Trecho" }).click();
    await expect(nodes(page)).toHaveCount(2);

    await nodeById(page, FRETE).click();
    await expect(
      panel(page).getByText("Resumo indisponível", { exact: true }),
    ).toHaveCount(1);
    await panel(page).getByRole("button", { name: "Tentar de novo" }).click();

    await expect(
      panel(page).getByText(FRETE_EXPLANATION.summary, { exact: true }),
    ).toHaveCount(1);
    await expect(panel(page).getByText("Resumo indisponível")).toHaveCount(0);
    expect(calls.filter((id) => id === FRETE)).toHaveLength(3);
  });
});
