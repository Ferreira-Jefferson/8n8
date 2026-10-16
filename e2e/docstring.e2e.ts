import { expect, type Locator, type Page, test } from "@playwright/test";
import { type FakeCall, fakeLog } from "./fake-llm";
import {
  cardOf,
  clickCard,
  freshReal,
  generate,
  nodeById,
  OFFLINE,
  panel,
  REAL,
} from "./mapa";

// Docstring: the model sees the code with the docstring masked; a docstring the
// answer calls false becomes a suggestion on the docstring's first line. Only the
// suggestions request gets the docstring block; the summary never sees it (CFG-03). Keyed
// server (4319) with the fake LLM; the module card case runs with no key (8148).

const LIE = '    """Soma os preços dos itens."""';
const BODY = "    n = len(itens)\n    print(n)\n    return n\n";
const MENTIROSO = `def total_mentiroso(itens):\n${LIE}\n${BODY}`;
const FIEL = `def total_fiel(itens):\n${LIE}\n${BODY}`;
const SEM_DOC = `def total_sem_doc(itens):\n${BODY}`;
const COMMAND =
  "Atualize a docstring: A docstring fala de soma de preços, mas o código usa `len`";

/** The suggestions drafts about one node: the request that judges the docstring. */
const drafts = (log: FakeCall[], marker: string) =>
  log.filter(
    (c) =>
      c.role === "suggest" &&
      c.messages.some((m) => m.role === "user" && m.content.includes(marker)),
  );
const lastUser = (call: FakeCall) =>
  call.messages.filter((m) => m.role === "user").at(-1)?.content ?? "";

const alerts = (page: Page) => page.locator("button.alert");
/** Suggestion buttons of the panel: "<comando> (linha N, <severidade>)". */
const suggestionButtons = (view: Locator) =>
  view
    .getByRole("heading", { name: "Sugestões", exact: true })
    .locator("xpath=following-sibling::ul[1]")
    .getByRole("button", { name: /\(linha \d+, / });

/** Generates the map, opens the function and waits for its summary. */
async function openFunction(
  page: Page,
  source: string,
  id: string,
): Promise<Locator> {
  await generate(page, REAL, source);
  await clickCard(page, id);
  const view = panel(page);
  await expect(view.getByRole("list", { name: "Resumo" })).toBeVisible();
  return view;
}

test.describe("Docstring", () => {
  test.beforeEach(freshReal);

  test("a docstring that lies: the model sees no docstring in the code, and a suggestion points at its line", async ({
    page,
  }) => {
    const view = await openFunction(page, MENTIROSO, "fn:total_mentiroso");

    const calls = drafts(await fakeLog(), "def total_mentiroso");
    expect(calls).toHaveLength(1);
    const [head, numbered] = lastUser(calls[0] as FakeCall).split(
      "\nCódigo:\n",
    );
    // The text goes apart in its own block...
    expect(head).toContain("Docstring (");
    expect(head).toContain(LIE.trim());
    // ...and the numbered code has the placeholder in its place.
    expect(numbered).toContain("2 | # docstring omitida");
    expect(numbered).not.toContain("Soma os preços");
    expect(numbered).not.toContain('"""');
    expect(numbered).toContain("3 |     n = len(itens)");
    // The summary draft never gets the docstring text (CFG-03).
    const summaries = (await fakeLog()).filter(
      (c) =>
        c.role === "draft" &&
        c.messages.some((m) => m.content.includes("def total_mentiroso")),
    );
    expect(summaries).toHaveLength(1);
    expect(lastUser(summaries[0] as FakeCall)).not.toContain("Docstring (");
    expect(lastUser(summaries[0] as FakeCall)).not.toContain("Soma os preços");

    await expect(alerts(page)).toHaveText([COMMAND]);
    await expect(suggestionButtons(view)).toHaveText([
      `${COMMAND} (linha 2, média)`,
    ]);

    await alerts(page).click();
    await expect(view.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(view.locator('[aria-current="true"]')).toHaveAttribute(
      "data-line",
      "2",
    );
    await expect(view.locator('[aria-current="true"] code')).toHaveText(LIE);

    // Back on the first level the function's card carries the badge.
    await page.keyboard.press("Escape");
    await expect(
      nodeById(page, "fn:total_mentiroso").getByTitle("Sugestões"),
    ).toHaveText("1");
  });

  test("a docstring that reflects the code: no docstring suggestion, but the model still got the block", async ({
    page,
  }) => {
    const view = await openFunction(page, FIEL, "fn:total_fiel");

    const calls = drafts(await fakeLog(), "def total_fiel");
    expect(calls).toHaveLength(1);
    expect(lastUser(calls[0] as FakeCall)).toContain("Docstring (");
    await expect(alerts(page)).toHaveCount(0);
    await expect(view.getByText("Atualize a docstring")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(
      nodeById(page, "fn:total_fiel").getByTitle("Sugestões"),
    ).toHaveCount(0);
  });

  test("a function with no docstring: no Docstring block, and no suggestion even if the answer has the field", async ({
    page,
  }) => {
    const view = await openFunction(page, SEM_DOC, "fn:total_sem_doc");

    const calls = drafts(await fakeLog(), "def total_sem_doc");
    expect(calls).toHaveLength(1);
    const user = lastUser(calls[0] as FakeCall);
    expect(user).not.toContain("Docstring (");
    expect(user).not.toContain("docstring omitida");
    await expect(alerts(page)).toHaveCount(0);
    await expect(view.getByText("Atualize a docstring")).toHaveCount(0);
  });
});

test("a module docstring: the GATILHO card shows the first real code line, not the quotes", async ({
  page,
}) => {
  // The module runs a call (print): loose code with no call is no entry (VID-12).
  const source =
    '"""Rotinas do pedido.\n\nMais detalhes aqui.\n"""\nLIMITE = 30\nNOME = "x"\nprint(NOME)\n\ndef a():\n    print(1)\n';
  const graph = await generate(page, OFFLINE, source);
  const module = graph.nodes.find((n) => n.kind === "module");
  expect(module?.docstring).toEqual({ start: 1, end: 4 });
  const id = module?.id as string;
  await expect(cardOf(page, id).locator(".tag")).toHaveText("GATILHO");
  await expect(cardOf(page, id).locator(".fn")).toHaveText("LIMITE = 30");
  await expect(cardOf(page, id)).not.toContainText('"""');
});
