import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectSkeleton } from "@8n8/model";
import { OFFLINE } from "./mapa";
import { expect, type Page, test } from "./test";

// A wire the code does not prove: the URL starts with a value known only at run time
// (`${config.baseUrl}/api/frete`). The wire still links, marked "a conferir", and its tag
// tells the code of the value and the file and line of the call. A literal URL stays proven.

let tmp = "";
let PASTA = "";

/** web.ts calls the route with a base from config; pedidos.ts calls it with a literal path. */
function makePasta(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "servidor.ts"),
    [
      'import { Hono } from "hono";',
      "",
      "const app = new Hono();",
      "",
      'app.post("/api/frete", (c) => c.json({ valor: 10 }));',
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "web.ts"),
    [
      'const config = { baseUrl: process.env.API_URL ?? "" };',
      "export function enviar(): void {",
      '  fetch(`${config.baseUrl}/api/frete`, { method: "POST" });',
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "pedidos.ts"),
    [
      "export function pedir(): void {",
      '  fetch("/api/frete", { method: "POST" });',
      "}",
      "",
    ].join("\n"),
  );
}

test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "8n8-a-conferir-"));
  PASTA = join(tmp, "conferir");
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
    page.locator('[aria-roledescription="node"][data-id="file:web.ts"]'),
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

test.describe("Ligação a conferir", () => {
  test("a call whose URL starts with a config value links with what to check; a literal one links proven", async ({
    page,
  }) => {
    const body = (await (
      await page.request.post(`${OFFLINE}/api/project`, {
        data: { path: PASTA },
      })
    ).json()) as ProjectSkeleton;
    const wireFrom = (file: string) =>
      body.graph.edges.find(
        (e) =>
          e.kind === "calls" &&
          e.source === `file:${file}` &&
          e.target === "file:servidor.ts",
      );

    expect(wireFrom("web.ts")?.toCheck).toEqual({
      code: "config.baseUrl",
      path: "web.ts",
      line: 3,
    });
    expect(wireFrom("pedidos.ts")).toBeDefined();
    expect(wireFrom("pedidos.ts")?.toCheck).toBeUndefined();
  });

  test("the wire to check carries a mark on screen, and its tag says the value and the call", async ({
    page,
  }) => {
    await openFolder(page);
    const marks = page.locator(".wire-check-mark");
    await expect(marks).toHaveCount(1);
    await expect(marks).toHaveText("a conferir");

    const point = await middleOf(
      page,
      "Aresta de file:web.ts para file:servidor.ts",
    );
    await page.mouse.move(point.x, point.y);
    const check = page.locator(".wire-tag .wire-tag-check");
    await expect(check.locator(".wire-tag-kind")).toHaveText("a conferir");
    await expect(check).toContainText("config.baseUrl");
    await expect(check).toContainText("web.ts:3");
  });

  test("the proven wire has no check in its tag", async ({ page }) => {
    await openFolder(page);
    const point = await middleOf(
      page,
      "Aresta de file:pedidos.ts para file:servidor.ts",
    );
    await page.mouse.move(point.x, point.y);
    await expect(page.locator(".wire-tag")).toBeVisible();
    await expect(page.locator(".wire-tag-check")).toHaveCount(0);
  });
});
