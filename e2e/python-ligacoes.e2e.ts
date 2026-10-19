import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectSkeleton } from "@8n8/model";
import { OFFLINE } from "./mapa";
import { expect, type Page, test } from "./test";

// Python wires that used to vanish or go to the wrong file:
// - a URL built from a config value (`f"{BASE}/prices"`, `BASE + "/prices"`) links to the route, "a conferir";
// - `from utils import *` + `render(1)` calls utils.py, not the `render` of a TypeScript file.

let tmp = "";
let PASTA = "";

function makePasta(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "api.py"),
    [
      "from fastapi import FastAPI",
      "",
      "app = FastAPI()",
      "",
      '@app.get("/prices")',
      "def prices():",
      "    return []",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "cliente.py"),
    [
      "import os",
      "import requests",
      "",
      'BASE = os.environ["API"]',
      "",
      "def buscar():",
      '    return requests.get(f"{BASE}/prices")',
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "utils.py"),
    ["def render(x):", "    return str(x)", ""].join("\n"),
  );
  writeFileSync(
    join(root, "view.py"),
    ["from utils import *", "", "def page():", "    return render(1)", ""].join(
      "\n",
    ),
  );
  writeFileSync(
    join(root, "render.ts"),
    [
      "export function render(x: number): string {",
      "  return String(x);",
      "}",
      "",
    ].join("\n"),
  );
}

test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "8n8-python-ligacoes-"));
  PASTA = join(tmp, "pyligacoes");
  makePasta(PASTA);
});

test.afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const openFolder = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("Caminho da pasta").fill(PASTA);
  await page.getByRole("button", { name: "Mapear pasta" }).click();
  await expect(
    page.locator('[aria-roledescription="node"][data-id="file:view.py"]'),
  ).toBeVisible();
};

/** The screen point in the middle of a wire's hover strip. */
const middleOf = async (page: Page, name: string) => {
  const point = await page
    .getByRole("group", { name })
    .locator("path.wire-hit")
    .evaluate((el) => {
      const path = el as SVGPathElement;
      const p = path.getPointAtLength(path.getTotalLength() / 2);
      const m = path.getScreenCTM();
      return m ? { x: m.a * p.x + m.e, y: m.d * p.y + m.f } : null;
    });
  if (!point) throw new Error(`no screen position for ${name}`);
  return point;
};

test.describe("Ligações do Python", () => {
  test("the API wires the f-string URL to the route, to check, and the `*` call to utils.py only", async ({
    page,
  }) => {
    const body = (await (
      await page.request.post(`${OFFLINE}/api/project`, {
        data: { path: PASTA },
      })
    ).json()) as ProjectSkeleton;
    const wire = (from: string, to: string) =>
      body.graph.edges.find(
        (e) =>
          e.kind === "calls" &&
          e.source === `file:${from}` &&
          e.target === `file:${to}`,
      );

    expect(wire("cliente.py", "api.py")?.toCheck).toEqual({
      code: "BASE",
      path: "cliente.py",
      line: 7,
    });
    expect(wire("view.py", "utils.py")).toBeDefined();
    expect(wire("view.py", "render.ts")).toBeUndefined();
  });

  test("the screen shows the wire to check with its value and call", async ({
    page,
  }) => {
    await openFolder(page);
    await expect(page.locator(".wire-check-mark")).toHaveCount(1);

    const point = await middleOf(
      page,
      "Aresta de file:cliente.py para file:api.py",
    );
    await page.mouse.move(point.x, point.y);
    const check = page.locator(".wire-tag .wire-tag-check");
    await expect(check.locator(".wire-tag-kind")).toHaveText("a conferir");
    await expect(check).toContainText("BASE");
    await expect(check).toContainText("cliente.py:7");
  });

  test("the screen wires view.py to utils.py and not to render.ts", async ({
    page,
  }) => {
    await openFolder(page);
    await expect(
      page.getByRole("group", {
        name: "Aresta de file:view.py para file:utils.py",
      }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("group", {
        name: "Aresta de file:view.py para file:render.ts",
      }),
    ).toHaveCount(0);
  });
});
