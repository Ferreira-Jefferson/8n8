import { type FakeCall, fakeLog } from "./fake-llm";
import {
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
