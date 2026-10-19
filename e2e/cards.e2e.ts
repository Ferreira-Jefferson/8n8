import {
  canvas,
  cardNames,
  cardTags,
  clickCard,
  expectLevel,
  generate,
  nodes,
  OFFLINE,
} from "./mapa";
import { expect, type Page, test } from "./test";

// What a card says about a step, on the server with no key (provisional names):
// an HTTP call shows its arguments, a `return` of an external call keeps the
// category, a class is CLASSE, a name stays as the code writes it, a callback
// body is not a step of whoever writes it, a computed call is DINÂMICA, a
// client factory is not HTTP, a docstring is not a step, and a class level draws
// the calls between its methods.

const TS = [
  'const cfg = { base: "http://x" };',
  "async function health() {",
  '  await fetch("/health");',
  `  await fetch(\`\${cfg.base}/users\`);`,
  '  return fetch("/ping");',
  "}",
  "async function run(handlers: any) {",
  '  const h = { a: () => console.log("a") };',
  '  handlers["a"]();',
  "  [1].map(() => health());",
  "}",
  "class UserService {",
  "  total(a: number) {",
  "    return this.helper(a);",
  "  }",
  "  helper(x: number) {",
  "    return x;",
  "  }",
  "}",
  "run({});",
  "",
].join("\n");

const PY = [
  "import requests",
  "",
  "s = requests.Session()",
  "lam = lambda x: alvo(x)",
  "",
  "",
  "def alvo(x):",
  "    return x",
  "",
  "",
  "class User:",
  '    """Um usuário."""',
  "",
  "    def __init__(self, name):",
  '        """Guarda o nome."""',
  "        self.name = name",
  "",
  "    def greet(self):",
  "        return self._fmt()",
  "",
  "    def _fmt(self):",
  '        return f"hi {self.name}"',
  "",
].join("\n");

/** The mono code line of each card of the level, in DOM order. */
const codeLines = (page: Page) =>
  nodes(page).evaluateAll((els) =>
    els.map((el) => el.querySelector(".fn")?.textContent ?? ""),
  );
const wire = (page: Page, from: string, to: string) =>
  canvas(page).getByRole("group", { name: `Aresta de ${from} para ${to}` });

test.describe("Cards of steps", () => {
  test("G10: each HTTP call shows its arguments, and a return of fetch keeps the HTTP tag", async ({
    page,
  }) => {
    await generate(page, OFFLINE, TS);
    await clickCard(page, "fn:health");
    await expectLevel(page, ["fn:health/s0", "fn:health/s1", "fn:health/s2"]);
    expect(await cardTags(page)).toEqual(["HTTP", "HTTP", "HTTP"]);
    expect(await cardNames(page)).toEqual(["fetch", "fetch", "Retorno"]);
    expect(await codeLines(page)).toEqual([
      'fetch("/health")',
      `fetch(\`\${cfg.base}/users\`)`,
      'return fetch("/ping");',
    ]);
  });

  test("G16: a class is CLASSE without (), and names stay as the code writes them", async ({
    page,
  }) => {
    await generate(page, OFFLINE, TS);
    await expect(nodes(page).first()).toBeVisible();
    const card = canvas(page).locator(
      '[data-id="cls:UserService"] .node[data-tag="CLASSE"]',
    );
    await expect(card.locator(".tag")).toHaveText("CLASSE");
    await expect(card.locator(".fn")).toHaveText("class UserService");
    expect(await cardNames(page)).toContain("UserService");
    expect(await cardNames(page)).toContain("health");
  });

  test("G17: a callback body is not a step, a computed call is DINÂMICA, and the callback still draws the call", async ({
    page,
  }) => {
    await generate(page, OFFLINE, TS);
    await expect(wire(page, "fn:run", "fn:health")).toHaveCount(1);
    await clickCard(page, "fn:run");
    await expectLevel(page, ["fn:run/s0", "fn:run/s1", "fn:run/s2"]);
    expect(await cardTags(page)).toEqual(["CÓDIGO", "DINÂMICA", "CÓDIGO"]);
    expect(await cardNames(page)).toEqual([
      "Código",
      "Chamada dinâmica",
      "Código",
    ]);
    expect((await codeLines(page))[1]).toBe('handlers["a"]();');
  });

  test("G12: a class level draws the call from total to helper", async ({
    page,
  }) => {
    await generate(page, OFFLINE, TS);
    await clickCard(page, "cls:UserService");
    await expectLevel(page, [
      "cls:UserService/fn:total",
      "cls:UserService/fn:helper",
    ]);
    await expect(
      wire(page, "cls:UserService/fn:total", "cls:UserService/fn:helper"),
    ).toHaveCount(1);
  });

  test("Python: no docstring step, __init__ as written, Session is not HTTP, a lambda is not a step, and greet calls _fmt", async ({
    page,
  }) => {
    await generate(page, OFFLINE, PY);
    await clickCard(page, "mod");
    await expectLevel(page, ["mod/s0", "mod/s1"]);
    expect(await cardTags(page)).toEqual(["EXTERNO", "CÓDIGO"]);

    await page.keyboard.press("Escape");
    await clickCard(page, "cls:User");
    await expectLevel(page, [
      "cls:User/fn:__init__",
      "cls:User/fn:greet",
      "cls:User/fn:_fmt",
    ]);
    expect(await cardNames(page)).toEqual(["__init__", "greet", "_fmt"]);
    await expect(
      wire(page, "cls:User/fn:greet", "cls:User/fn:_fmt"),
    ).toHaveCount(1);

    await clickCard(page, "cls:User/fn:__init__");
    await expectLevel(page, ["cls:User/fn:__init__/s0"]);
    expect(await codeLines(page)).toEqual(["self.name = name"]);
  });
});
