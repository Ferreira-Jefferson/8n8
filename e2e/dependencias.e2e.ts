import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { canvas, css, generate, nodes, OFFLINE } from "./mapa";

// The dependency wires (calls, extends, imports) on the real app, in the awkward
// shapes: a function that calls itself, calls both ways, a cycle of three, a
// function called by five, an inheritance tree, a folder with cross-file calls.
// Every scenario also checks the things that must hold for any graph: no script
// error, no NaN in a path, and no wire running behind a card it does not join.

const DIM = "rgb(107, 112, 111)";
const MAIN = "rgb(61, 191, 168)";

const flow = (page: Page) => page.getByRole("application");
const wires = (page: Page, kind?: string) =>
  flow(page).locator(
    `[aria-roledescription="edge"]${kind ? `.edge-${kind}` : '.reach-inside, [aria-roledescription="edge"].reach-across'}`,
  );
const wire = (page: Page, from: string, to: string) =>
  canvas(page).getByRole("group", { name: `Aresta de ${from} para ${to}` });

/** Collects what the page throws, so a scenario can fail on a silent script error. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

/** The wires whose path runs through a card that is neither of their two ends. */
async function wiresBehindCards(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const cards = [
      ...document.querySelectorAll<HTMLElement>(".react-flow__node"),
    ].map((n) => ({
      id: n.getAttribute("data-id") ?? "",
      r: n.getBoundingClientRect(),
    }));
    const found = new Set<string>();
    for (const g of document.querySelectorAll(
      '[aria-roledescription="edge"]',
    )) {
      const label = g.getAttribute("aria-label") ?? "";
      const ends = label.match(/^Aresta de (.*) para (.*)$/);
      const path = g.querySelector<SVGPathElement>("path.wire");
      const ctm = path?.getScreenCTM();
      if (!ends || !path || !ctm) continue;
      const length = path.getTotalLength();
      for (let at = 0; at <= length; at += 6) {
        const p = path.getPointAtLength(at);
        const pt = new DOMPoint(p.x, p.y).matrixTransform(ctm);
        for (const c of cards) {
          if (c.id === ends[1] || c.id === ends[2]) continue;
          const pad = 6;
          const inside =
            pt.x > c.r.left + pad &&
            pt.x < c.r.right - pad &&
            pt.y > c.r.top + pad &&
            pt.y < c.r.bottom - pad;
          if (inside) found.add(`${label} through ${c.id}`);
        }
      }
    }
    return [...found];
  });
}

/** The `d` of every wire path of the level. */
const paths = (page: Page) =>
  flow(page)
    .locator("path.wire")
    .evaluateAll((els) => els.map((el) => el.getAttribute("d") ?? ""));

/** What must hold on any level: no error, no NaN, no wire behind a card. */
async function expectSound(page: Page, errors: string[]): Promise<void> {
  expect(await wiresBehindCards(page)).toEqual([]);
  for (const d of await paths(page)) expect(d).not.toContain("NaN");
  expect(errors).toEqual([]);
}

const PYTHON = `class Animal:
    pass


class Cao(Animal):
    pass


class Gato(Animal):
    pass


def contar(n):
    return contar(n - 1)


def par(n):
    return impar(n)


def impar(n):
    return par(n)


def a():
    return b()


def b():
    return c()


def c():
    return a()


def util():
    return 1


def u1():
    return util()


def u2():
    return util()


def u3():
    return util()


def u4():
    return util()


def u5():
    return util()
`;

test.describe("O trecho em Python com todos os casos", () => {
  test("draws 2 inheritance wires and 11 call wires, all gray, between 15 cards", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const graph = await generate(page, OFFLINE, PYTHON);
    expect(graph.edges.filter((e) => e.kind === "extends")).toHaveLength(2);

    await expect(nodes(page)).toHaveCount(15);
    await expect(wires(page, "extends")).toHaveCount(2);
    await expect(wires(page, "calls")).toHaveCount(11);
    for (const el of await wires(page).all()) {
      await expect(el).toHaveClass(/\breach-inside\b/);
    }
    expect(
      await css(wires(page, "calls").first().locator("path.wire"), "stroke"),
    ).toBe(DIM);
    await expectSound(page, errors);
  });

  test("a function that calls itself gets an arch over its own card", async ({
    page,
  }) => {
    await generate(page, OFFLINE, PYTHON);
    const loop = wire(page, "fn:contar", "fn:contar");
    await expect(loop).toHaveCount(1);
    const box = await loop.locator("path.wire").evaluate((el) => {
      const b = (el as SVGPathElement).getBBox();
      return { top: b.y, bottom: b.y + b.height, width: b.width };
    });
    const card = await page
      .locator('[aria-roledescription="node"][data-id="fn:contar"]')
      .evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
    // The arch spans the card from its right port to its left port, and rises above them.
    expect(box.width).toBeGreaterThan(card * 0.5);
    expect(box.top).toBeLessThan(box.bottom - 40);
  });

  test("two functions that call each other get two wires, on different sides", async ({
    page,
  }) => {
    await generate(page, OFFLINE, PYTHON);
    const ab = wire(page, "fn:par", "fn:impar");
    const ba = wire(page, "fn:impar", "fn:par");
    await expect(ab).toHaveCount(1);
    await expect(ba).toHaveCount(1);
    const [da, db] = await Promise.all([
      ab.locator("path.wire").getAttribute("d"),
      ba.locator("path.wire").getAttribute("d"),
    ]);
    expect(da).not.toBe(db);
  });

  test("a cycle of three and a function called by five keep every wire", async ({
    page,
  }) => {
    await generate(page, OFFLINE, PYTHON);
    const pairs: [string, string][] = [
      ["fn:a", "fn:b"],
      ["fn:b", "fn:c"],
      ["fn:c", "fn:a"],
      ["fn:u1", "fn:util"],
      ["fn:u2", "fn:util"],
      ["fn:u3", "fn:util"],
      ["fn:u4", "fn:util"],
      ["fn:u5", "fn:util"],
    ];
    for (const [from, to] of pairs) {
      await expect(wire(page, from, to)).toHaveCount(1);
    }
  });

  test("a call wire starts at a filled port and ends at a hollow ring", async ({
    page,
  }) => {
    await generate(page, OFFLINE, PYTHON);
    const start = page.locator(
      '[data-id="fn:u1"] .port-out.port-dep:not([style*="hidden"])',
    );
    const end = page.locator(
      '[data-id="fn:util"] .port-in.port-dep:not([style*="hidden"])',
    );
    await expect(start.first()).toBeVisible();
    await expect(end.first()).toBeVisible();
    expect(await css(start.first(), "background-color")).toBe(DIM);
    // The end is a ring: the ground fills it and a 3 px border carries the colour.
    expect(await css(end.first(), "border-top-width")).toBe("3px");
    expect(await css(end.first(), "border-top-color")).toBe(DIM);
    expect(await css(end.first(), "background-color")).not.toBe(DIM);
  });

  test("the call dashes move, and the inheritance and import dashes stay still", async ({
    page,
  }) => {
    await generate(page, OFFLINE, PYTHON);
    expect(
      await css(
        wires(page, "calls").first().locator("path.wire"),
        "animation-name",
      ),
    ).toBe("wire-march");
    expect(
      await css(
        wires(page, "extends").first().locator("path.wire"),
        "animation-name",
      ),
    ).toBe("none");
  });

  test("an inheritance wire is dash, dot, dot; a call wire shortens its dashes", async ({
    page,
  }) => {
    await generate(page, OFFLINE, PYTHON);
    const pattern = (kind: string) =>
      css(wires(page, kind).first().locator("path.wire"), "stroke-dasharray");
    expect(await pattern("extends")).toBe("19px, 8px, 3px, 8px, 3px, 8px");
    expect(await pattern("calls")).toBe(
      "29px, 8px, 18px, 8px, 10px, 8px, 3px, 8px",
    );
  });
});

test.describe("Com movimento reduzido", () => {
  test.use({ reducedMotion: "reduce" });

  test("the call dashes stand still", async ({ page }) => {
    await generate(page, OFFLINE, PYTHON);
    expect(
      await css(
        wires(page, "calls").first().locator("path.wire"),
        "animation-name",
      ),
    ).toBe("none");
  });
});

const TYPESCRIPT = `class Animal {}

class Cao extends Animal {}

function contar(n: number): number {
  return contar(n - 1);
}

function a(): number {
  return b();
}

function b(): number {
  return a();
}
`;

test.describe("O trecho em TypeScript", () => {
  test("draws the inheritance wire, the arch and the two calls both ways", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const graph = await generate(page, OFFLINE, TYPESCRIPT);
    expect(graph.language).toBe("typescript");
    expect(graph.edges.filter((e) => e.kind === "extends")).toHaveLength(1);

    await expect(nodes(page)).toHaveCount(5);
    await expect(wires(page, "extends")).toHaveCount(1);
    await expect(wires(page, "calls")).toHaveCount(3);
    await expectSound(page, errors);
  });
});

const CHAIN = Array.from({ length: 25 }, (_, i) =>
  i === 24
    ? `def f${i}():\n    return 1\n`
    : `def f${i}():\n    return f${i + 1}()\n`,
).join("\n\n");

test.describe("Um trecho grande", () => {
  test("25 functions in a call chain draw 25 cards and 24 wires without error", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await generate(page, OFFLINE, CHAIN);
    await expect(nodes(page)).toHaveCount(25);
    await expect(wires(page, "calls")).toHaveCount(24);
    await expectSound(page, errors);
  });
});

test.describe("Um trecho com erro de sintaxe", () => {
  test("still draws the function it can read, and throws no error", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await generate(page, OFFLINE, "def bom():\n    return 1\n\ndef ruim(:\n");
    await expect(nodes(page).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});

let tmp = "";
let PASTA = "";

function writeFolder(root: string): void {
  mkdirSync(root, { recursive: true });
  const files: Record<string, string> = {
    "base.py": "class Base:\n    pass\n\n\ndef util():\n    return 1\n",
    "filho.py":
      "from base import Base, util\n\n\nclass Filho(Base):\n    def m(self):\n        return util()\n",
    "solto.py": "import base\n\nX = 1\n",
    "ciclo_a.py": "from ciclo_b import b\n\n\ndef a():\n    return b()\n",
    "ciclo_b.py": "from ciclo_a import a\n\n\ndef b():\n    return a()\n",
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(root, name), text);
  }
}

test.describe("Uma pasta com chamadas entre arquivos", () => {
  test.beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "8n8-dep-"));
    PASTA = join(tmp, "app");
    writeFolder(PASTA);
  });
  test.afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  async function open(page: Page): Promise<void> {
    await page.goto(`${OFFLINE}/`);
    await page.getByLabel("Caminho da pasta").fill(PASTA);
    await page.getByRole("button", { name: "Mapear pasta" }).click();
    await expect(nodes(page)).toHaveCount(5);
  }

  test("draws one green wire per pair of files, the call winning over the import and the inheritance", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await open(page);
    // filho -> base (a call and an inheritance: one wire), solto -> base (import),
    // ciclo_a <-> ciclo_b (a call each way).
    await expect(wires(page)).toHaveCount(4);
    await expect(wire(page, "file:filho.py", "file:base.py")).toHaveClass(
      /\bedge-calls\b.*\breach-across\b/,
    );
    await expect(wire(page, "file:solto.py", "file:base.py")).toHaveClass(
      /\bedge-imports\b.*\breach-across\b/,
    );
    await expect(wire(page, "file:ciclo_a.py", "file:ciclo_b.py")).toHaveCount(
      1,
    );
    await expect(wire(page, "file:ciclo_b.py", "file:ciclo_a.py")).toHaveCount(
      1,
    );
    expect(
      await css(wires(page, "calls").first().locator("path.wire"), "stroke"),
    ).toBe(MAIN);
    await expectSound(page, errors);
  });

  test("a file level has no wire to another file, and its hub still shows", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await open(page);
    await page
      .locator('[aria-roledescription="node"][data-id="file:filho.py"]')
      .dispatchEvent("click");
    await expect(nodes(page).first()).toBeVisible();
    await expect(wires(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
