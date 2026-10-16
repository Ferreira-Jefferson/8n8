import { type FakeCall, fakeLog } from "./fake-llm";
import {
  canvas,
  cardNames,
  clickCard,
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

// The chat of a node: a tab beside the code where the person asks about the open
// node and its parent. Keyed server against the fake LLM, which answers by a word
// of the question ("longo", "linha", "falha").

const HTTP = `${FRETE}/s0`;
const chats = (log: FakeCall[]) => log.filter((c) => c.role === "chat");

/** The video map, inside calcular_frete, with its first step open in the panel. */
async function openStep(page: Page): Promise<void> {
  await generate(page, REAL, VIDEO);
  await expectLevel(page, MAIN_FLOW);
  await expect.poll(() => cardNames(page)).toContain("Calcular frete");
  await clickCard(page, `${PEDIDO}/s3`);
  await expectLevel(page, FRETE_LEVEL);
  await clickCard(page, HTTP);
  await openTab(page, "Conversa");
}

const log = (page: Page) => panel(page).getByRole("log");
const box = (page: Page) => panel(page).getByRole("textbox");
const send = (page: Page) =>
  panel(page).getByRole("button", { name: "Enviar" });

async function ask(page: Page, text: string): Promise<void> {
  await box(page).fill(text);
  await box(page).press("Enter");
}

test.beforeEach(freshReal);

test("the tabs go Código, Conversa, Resumo, Sugestões, and the code is the open one", async ({
  page,
}) => {
  await generate(page, REAL, VIDEO);
  await expectLevel(page, MAIN_FLOW);
  await clickCard(page, FRETE);
  await expect(panel(page).getByRole("tab")).toHaveText([
    "Código",
    "Conversa",
    "Resumo",
    /^Sugestões/,
  ]);
  await expect(
    panel(page).getByRole("tab", { name: "Código", selected: true }),
  ).toBeVisible();
  await openTab(page, "Conversa");
  await expect(
    panel(page).getByText("Pergunte sobre este nó e sobre o pai dele."),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "/resumo" }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "/sugestões" }),
  ).toBeVisible();
});

test("a question gets a short answer, and the model reads the node and its whole parent, in the language of the system, under the size limit", async ({
  page,
}) => {
  await openStep(page);
  await ask(page, "o que faz?");
  await expect(
    log(page).getByText("o que faz?", { exact: true }),
  ).toBeVisible();
  await expect(log(page).getByText("Resposta sobre: o que faz?")).toBeVisible();
  await expect(box(page)).toHaveValue("");

  const [call] = chats(await fakeLog());
  expect(chats(await fakeLog())).toHaveLength(1);
  const system = call?.messages[0]?.content ?? "";
  // The prompt: only this code, a size limit, the Portuguese rules.
  expect(system).toContain("no máximo 600 caracteres");
  expect(system).toContain("só sobre esse código");
  expect(system).toContain("Português Técnico Simplificado");
  // The step, with the real line, and the function that holds it, whole.
  expect(system).toContain("18 | ");
  expect(system).toContain("Pai (inteiro): calcular_frete");
  expect(system).toContain("17 | def calcular_frete");
  expect(call?.messages.at(-1)).toEqual({
    role: "user",
    content: "o que faz?",
  });
});

test("an answer over the limit is cut at a word, with an ellipsis", async ({
  page,
}) => {
  await openStep(page);
  await ask(page, "responda longo");
  const answer = log(page).locator(".msg.assistant").last();
  await expect(answer).toContainText("…");
  const text = (await answer.textContent()) ?? "";
  expect(text.length).toBeLessThanOrEqual(601);
});

test("a line mark in the answer marks that line in the code", async ({
  page,
}) => {
  await openStep(page);
  await ask(page, "qual linha chama a rede?");
  await log(page).getByRole("button", { name: "L18" }).click();
  await expect(
    panel(page).getByRole("tab", { name: "Código", selected: true }),
  ).toBeVisible();
  await expect(panel(page).locator('[aria-current="true"]')).toHaveAttribute(
    "data-line",
    "18",
  );
});

test("the next question carries the past of the conversation", async ({
  page,
}) => {
  await openStep(page);
  await ask(page, "primeira");
  await expect(log(page).getByText("Resposta sobre: primeira")).toBeVisible();
  await ask(page, "segunda");
  await expect(log(page).getByText("Resposta sobre: segunda")).toBeVisible();
  const [, second] = chats(await fakeLog());
  expect(second?.messages.slice(1).map((m) => [m.role, m.content])).toEqual([
    ["user", "primeira"],
    ["assistant", "Resposta sobre: primeira"],
    ["user", "segunda"],
  ]);
});

test("/resumo runs the summary in the chat, with no call to the chat, and the Resumo tab shows the same one without a new call", async ({
  page,
}) => {
  await openStep(page);
  await panel(page).getByRole("button", { name: "/resumo" }).click();
  await expect(
    log(page).getByText("A função consulta uma API externa com o CEP."),
  ).toBeVisible();
  // The summary of this step, however many drafts the review made of it.
  const drafts = () =>
    fakeLog().then(
      (l) =>
        l.filter(
          (c) =>
            c.role === "draft" &&
            c.messages.some((m) => m.content.includes("viacep")),
        ).length,
    );
  const asked = await drafts();
  expect(asked).toBeGreaterThan(0);
  expect(chats(await fakeLog())).toHaveLength(0);
  await openTab(page, "Resumo");
  await expect(
    panel(page)
      .getByRole("list", { name: "Resumo" })
      .getByText("A função consulta uma API externa com o CEP."),
  ).toBeVisible();
  expect(await drafts()).toBe(asked);

  // Typed, it is the same shortcut.
  await openTab(page, "Conversa");
  await ask(page, "/sugestoes");
  await expect(log(page).getByText("/sugestoes")).toBeVisible();
  expect(chats(await fakeLog())).toHaveLength(0);
});

test("a failed answer shows the failure with a retry that asks the same question again", async ({
  page,
}) => {
  await openStep(page);
  await ask(page, "isso vai dar falha");
  await expect(
    log(page).getByRole("button", { name: "Tentar de novo" }),
  ).toBeVisible();
  expect(chats(await fakeLog())).toHaveLength(1);
  await log(page).getByRole("button", { name: "Tentar de novo" }).click();
  await expect.poll(async () => chats(await fakeLog()).length).toBe(2);
  await expect(log(page).getByText("isso vai dar falha")).toHaveCount(1);
});

test("the conversation of a node comes back when you return to it", async ({
  page,
}) => {
  await openStep(page);
  await ask(page, "guarde isto");
  await expect(
    log(page).getByText("Resposta sobre: guarde isto"),
  ).toBeVisible();
  await clickCard(page, `${FRETE}/s1`);
  await openTab(page, "Conversa");
  await expect(log(page).getByText("guarde isto")).toHaveCount(0);
  await clickCard(page, HTTP);
  await openTab(page, "Conversa");
  await expect(
    log(page).getByText("Resposta sobre: guarde isto"),
  ).toBeVisible();
  expect(chats(await fakeLog())).toHaveLength(1);
});

test("the send button is square, in a bar below the text, and the field grows with the text without moving it", async ({
  page,
}) => {
  await openStep(page);
  const composer = panel(page).locator(".chat-composer");
  const bar = panel(page).locator(".chat-bar");
  const at = async (target: Locator) =>
    (await target.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const button = await at(send(page));
  expect(button.width).toBe(button.height);
  // The bar is apart from the field: the button is under the text and inside the box.
  const field = await at(box(page));
  const outer = await at(composer);
  expect(button.y).toBeGreaterThanOrEqual(field.y + field.height);
  expect(button.x + button.width).toBeLessThanOrEqual(outer.x + outer.width);
  expect(button.y + button.height).toBeLessThanOrEqual(outer.y + outer.height);
  // The shortcuts sit in the same bar, on the left.
  const chip = await at(panel(page).getByRole("button", { name: "/resumo" }));
  expect(chip.x + chip.width).toBeLessThan(button.x);
  expect(
    Math.abs(chip.y + chip.height / 2 - (button.y + button.height / 2)),
  ).toBeLessThan(button.height);
  await expect(bar).toBeVisible();

  await expect(send(page)).toBeDisabled();
  await box(page).fill("oi");
  await expect(send(page)).toBeEnabled();

  // A long text grows the field, up to a limit; the button stays at the base.
  const before = await at(box(page));
  await box(page).fill(
    Array.from({ length: 12 }, (_, i) => `linha ${i}`).join("\n"),
  );
  const after = await at(box(page));
  expect(after.height).toBeGreaterThan(before.height);
  expect(after.height).toBeLessThanOrEqual(168);
  const moved = await at(send(page));
  expect(moved.y).toBeGreaterThanOrEqual(after.y + after.height);
  expect(moved.height).toBe(button.height);
});

// The suggestions of a node, kept from the chat or removed from the list.

const KEPT = "Defina um timeout na chamada HTTP. (linha 18, média)";
const suggestionsTab = (page: Page) =>
  panel(page).locator("#panel-suggestions");
const keepIcon = (page: Page) =>
  log(page).getByRole("button", { name: "Salvar como sugestão" });
const keptIcon = (page: Page) =>
  log(page).getByRole("button", { name: "Remover das sugestões" });

test("a suggestion the model finds in an answer is kept at once, shows under Da conversa, and the icon takes it back", async ({
  page,
}) => {
  await openStep(page);
  await ask(page, "alguma melhoria?");
  await expect(log(page).getByText("Salva nas sugestões")).toBeVisible();
  await expect(keptIcon(page)).toHaveAttribute("aria-pressed", "true");

  await openTab(page, "Sugestões");
  await expect(suggestionsTab(page).getByText("Da conversa")).toBeVisible();
  await expect(suggestionsTab(page).getByText(KEPT)).toBeVisible();
  await expect(
    panel(page).getByRole("tab", { name: /^Sugestões/ }),
  ).toContainText("1");

  // The same icon, in the chat, takes it back: it leaves the list.
  await openTab(page, "Conversa");
  await keptIcon(page).click();
  await expect(keepIcon(page)).toBeVisible();
  await openTab(page, "Sugestões");
  await expect(suggestionsTab(page).getByText(KEPT)).toHaveCount(0);
  await expect(
    panel(page).getByRole("tab", { name: /^Sugestões/ }),
  ).not.toContainText("1");
});

test("the person can keep any answer by hand, and an answer with no suggestion says so", async ({
  page,
}) => {
  await openStep(page);
  await ask(page, "e o timeout?");
  await expect(
    log(page).getByText("Um timeout evita que a chamada trave"),
  ).toBeVisible();
  // Nothing was kept on its own.
  await expect(log(page).getByText("Salva nas sugestões")).toHaveCount(0);
  await keepIcon(page).click();
  await expect(log(page).getByText("Salva nas sugestões")).toBeVisible();
  await openTab(page, "Sugestões");
  await expect(suggestionsTab(page).getByText(KEPT)).toBeVisible();

  await openTab(page, "Conversa");
  await ask(page, "o que faz?");
  await expect(log(page).getByText("Resposta sobre: o que faz?")).toBeVisible();
  await keepIcon(page).click();
  await expect(
    log(page).getByText("Não achei uma sugestão concreta nessa resposta."),
  ).toBeVisible();
});

test("a removed suggestion stays removed, and the kept ones stay, in a new map of the same code", async ({
  page,
}) => {
  await generate(page, REAL, VIDEO);
  await expectLevel(page, MAIN_FLOW);
  await clickCard(page, FRETE);
  await openTab(page, "Sugestões");
  const generated = suggestionsTab(page).getByText(
    "Trate o erro da chamada HTTP (linha 18, alta)",
  );
  await expect(generated).toBeVisible();
  await suggestionsTab(page)
    .locator("li", { hasText: "Trate o erro da chamada HTTP" })
    .getByRole("button", { name: "Remover sugestão" })
    .click();
  await expect(generated).toHaveCount(0);
  // The badge of the card loses it too.
  await page.keyboard.press("Escape");
  await expect(canvas(page).locator(".step-badge")).toHaveCount(0);

  // A new map of the same code: the server remembers.
  await generate(page, REAL, VIDEO);
  await expectLevel(page, MAIN_FLOW);
  await clickCard(page, FRETE);
  await openTab(page, "Sugestões");
  await expect(
    panel(page).getByText("Nenhuma sugestão para este nó."),
  ).toBeVisible();
  await expect(generated).toHaveCount(0);
});

test("a kept suggestion adds to the badge of the card of its line, and removing it from the list takes it off", async ({
  page,
}) => {
  await openStep(page);
  await ask(page, "alguma melhoria?");
  await expect(log(page).getByText("Salva nas sugestões")).toBeVisible();
  // The step already had one generated suggestion: the badge counts both.
  await expect(canvas(page).locator(".step-badge")).toHaveText(["2"]);
  await openTab(page, "Sugestões");
  await suggestionsTab(page)
    .locator("li", { hasText: "Defina um timeout" })
    .getByRole("button", { name: "Remover sugestão" })
    .click();
  await expect(canvas(page).locator(".step-badge")).toHaveText(["1"]);
  // The icon of the chat follows the list.
  await openTab(page, "Conversa");
  await expect(keepIcon(page)).toBeVisible();
});

test("the save icon shows on hover and stays when the answer is kept", async ({
  page,
}) => {
  await openStep(page);
  await ask(page, "alguma melhoria?");
  await expect(keptIcon(page)).toBeVisible();
  expect(
    await keptIcon(page).evaluate((el) => getComputedStyle(el).opacity),
  ).toBe("1");
  await keptIcon(page).click();
  await expect(keepIcon(page)).toBeAttached();
  // Away from the bubble the icon hides.
  await page.mouse.move(0, 0);
  expect(
    await keepIcon(page).evaluate((el) => getComputedStyle(el).opacity),
  ).toBe("0");
  await log(page).locator(".msg.assistant").last().hover();
  await expect(keepIcon(page)).toHaveCSS("opacity", "1");
});
