import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type FakeCall, fakeLog, resetFake } from "./fake-llm";
import {
  CACHE,
  cardNames,
  clickCard,
  expectLevel,
  FRETE_LEVEL,
  freshReal,
  generate,
  MAIN_FLOW,
  nodeById,
  nodes,
  OFFLINE,
  PEDIDO,
  REAL,
  VIDEO,
} from "./mapa";

// Feature 05, titles (VID-14..17): the keyed server (4319) asks the fake LLM
// for one batch of titles per level and reviews them; the server with no key
// (4317) shows provisional names.

const titleCalls = (log: FakeCall[]) => log.filter((c) => c.role === "title");
const titleReviews = (log: FakeCall[]) =>
  log.filter((c) => c.role === "title-review");
/** The last user message of a call, as the LLM reads it. */
const lastUser = (call: FakeCall) =>
  call.messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
/** The node blocks `[nX] ...` of a title request: one per node. */
const blocks = (call: FakeCall) =>
  lastUser(call)
    .split(/\n(?=\[n\d+\] )/)
    .filter((b) => /^\[n\d+\] /.test(b));

/** Every title cache entry of the keyed server. */
function titleEntries(): {
  fingerprint: Record<string, string>;
  title: { text: string };
}[] {
  const dir = join(CACHE, "titles");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

/** The video titles of the main flow, once they arrived (fake table, D1). */
const VIDEO_TITLES = [
  "Pedido recebido",
  "Ler o pedido",
  "Validar pedido",
  "Buscar o cliente",
  "Calcular frete",
  "Somar os itens",
  "Salvar no banco",
  "Enviar e-mail",
];

async function mapWithTitles(page: Page, source: string): Promise<void> {
  await generate(page, REAL, source);
  await expectLevel(page, MAIN_FLOW);
  await expect.poll(() => cardNames(page)).toEqual(VIDEO_TITLES);
}

test.describe("Títulos", () => {
  test.beforeEach(freshReal);

  test("VID-14: one title request for the level's 8 nodes, one review, and the cards show the titles", async ({
    page,
  }) => {
    await mapWithTitles(page, VIDEO);
    let log = await fakeLog();
    expect(titleCalls(log)).toHaveLength(1);
    expect(blocks(titleCalls(log)[0] as FakeCall)).toHaveLength(8);
    expect(titleReviews(log)).toHaveLength(1);
    for (const name of [
      "Pedido recebido",
      "Calcular frete",
      "Salvar no banco",
      "Enviar e-mail",
    ]) {
      expect(await cardNames(page)).toContain(name);
    }

    await resetFake();
    await clickCard(page, `${PEDIDO}/s3`);
    await expectLevel(page, FRETE_LEVEL);
    await expect
      .poll(() => cardNames(page))
      .toEqual([
        "Buscar UF pelo CEP",
        "Somar peso",
        "Peso acima de 30?",
        "Tabela pesada",
        "Tabela padrão",
      ]);
    log = await fakeLog();
    expect(titleCalls(log)).toHaveLength(1);
    expect(blocks(titleCalls(log)[0] as FakeCall)).toHaveLength(5);
  });

  test("VID-14: a title longer than 6 words never shows and never reaches the reviewer", async ({
    page,
  }) => {
    await generate(page, REAL, "def registrar_log(msg):\n    print(msg)\n");
    await expectLevel(page, ["fn:registrar_log", "fn:registrar_log/s0"]);
    await expect.poll(async () => titleCalls(await fakeLog())).toHaveLength(1);
    // The request is answered; give the page time to show a title if it came.
    await page.waitForLoadState("networkidle");
    expect((await cardNames(page))[0]).toBe("Registrar log");
    await expect(
      page.getByText("Registrar a mensagem no log do sistema"),
    ).toHaveCount(0);
    const reviewed = titleReviews(await fakeLog())
      .map(lastUser)
      .join("\n");
    expect(reviewed).not.toContain("Registrar a mensagem");
    expect(
      titleEntries().filter((e) => e.title.text.startsWith("Registrar")),
    ).toEqual([]);
  });

  test("VID-16: a title the reviewer rejects is dropped, and the card keeps the provisional name", async ({
    page,
  }) => {
    await generate(
      page,
      REAL,
      "def aplicar_desconto(total):\n    return total * 0.9\n",
    );
    await expectLevel(page, ["fn:aplicar_desconto"]);
    await expect
      .poll(async () => titleReviews(await fakeLog()))
      .toHaveLength(1);
    await page.waitForLoadState("networkidle");
    // The title went to the reviewer and came back rejected.
    expect(lastUser(titleReviews(await fakeLog())[0] as FakeCall)).toContain(
      "Aplicar desconto no total",
    );
    expect(await cardNames(page)).toEqual(["Aplicar desconto"]);
    await expect(page.getByText("Aplicar desconto no total")).toHaveCount(0);
    expect(titleEntries()).toEqual([]);
  });

  test("VID-17: titles come from the cache with the summary fingerprint; a changed node asks again", async ({
    page,
  }) => {
    await mapWithTitles(page, VIDEO);
    const entries = titleEntries();
    expect(entries).toHaveLength(8);
    for (const e of entries) {
      expect(Object.keys(e.fingerprint).sort()).toEqual([
        "code",
        "model",
        "neighbours",
        "promptVersion",
        "reviewModel",
        "reviewerVersion",
      ]);
      expect(e.fingerprint.model).toBe("e2e/drafter");
      expect(e.fingerprint.reviewModel).toBe("e2e/reviewer");
    }

    await resetFake();
    await mapWithTitles(page, VIDEO);
    expect(titleCalls(await fakeLog())).toHaveLength(0);

    await resetFake();
    const changed = VIDEO.replace(
      "enviar_email(cliente.email, total)",
      "enviar_email(cliente.email, total, pedido)",
    );
    await mapWithTitles(page, changed);
    const calls = titleCalls(await fakeLog());
    expect(calls).toHaveLength(1);
    const asked = blocks(calls[0] as FakeCall);
    // SPEC_DEVIATION: tasks.md T45 says the request holds only the e-mail node.
    // Reason: the entry's code (lines 6-14) holds the changed line 13, so by
    // VID-17 its fingerprint changes too. The other 6 nodes come from the cache.
    expect(asked.map((b) => /Nome: (\S+)/.exec(b)?.[1])).toEqual([
      "processar_pedido",
      "enviar_email",
    ]);
    for (const b of asked) {
      expect(b).toContain("enviar_email(cliente.email, total, pedido)");
    }
  });
});

test.describe("Nomes provisórios", () => {
  test("VID-15: with no key the cards show provisional names: last segment, spaces, capital; condition text; Código", async ({
    page,
  }) => {
    await generate(page, OFFLINE, VIDEO);
    await expectLevel(page, MAIN_FLOW);
    await page.waitForLoadState("networkidle");
    expect(await cardNames(page)).toEqual([
      "Processar pedido",
      "Loads",
      "Validar pedido",
      "Buscar cliente",
      "Calcular frete",
      "Soma itens",
      "Salvar",
      "Enviar email",
    ]);
    // The full name stays in the title attribute, without the open mark.
    await expect(
      nodeById(page, `${PEDIDO}/s3`).locator(".name"),
    ).toHaveAttribute("title", "Calcular frete");

    await clickCard(page, `${PEDIDO}/s3`);
    await expectLevel(page, FRETE_LEVEL);
    expect(await cardNames(page)).toEqual([
      "Get",
      "Sum",
      "peso > 30",
      "Retorno",
      "Retorno",
    ]);

    await generate(page, OFFLINE, "def f():\n    x = 1\n    print(x)\n");
    await expectLevel(page, ["fn:f", "fn:f/s1"]);
    await clickCard(page, "fn:f");
    await expectLevel(page, ["fn:f/s0", "fn:f/s1"]);
    expect(await cardNames(page)).toEqual(["Código", "Print"]);
  });

  test("VID-15: a failed title request keeps the provisional name and the map keeps working", async ({
    page,
  }) => {
    await freshReal();
    await generate(page, REAL, "def falha_titulo():\n    print(1)\n");
    await expectLevel(page, ["fn:falha_titulo", "fn:falha_titulo/s0"]);
    await expect.poll(async () => titleCalls(await fakeLog())).toHaveLength(1);
    await page.waitForLoadState("networkidle");
    expect(await cardNames(page)).toEqual(["Falha titulo", "Print"]);
    await clickCard(page, "fn:falha_titulo");
    await expectLevel(page, ["fn:falha_titulo/s0"]);
    await expect(nodes(page)).toHaveCount(1);
  });
});
