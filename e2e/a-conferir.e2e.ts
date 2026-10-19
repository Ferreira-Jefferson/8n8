import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectSkeleton } from "@8n8/model";
import { OFFLINE } from "./mapa";
import { expect, type Page, test } from "./test";

// A wire the code does not prove: the URL starts with a value known only at run time
// (`${config.baseUrl}/api/frete`). The wire still links, marked "a conferir", and its tag
// tells the code of the value and the file and line of the call. A literal URL stays proven.
// The other reasons: a literal path that meets only a parameter of the route, a call that more
// than one target matches, and a link by name only. A wire that joins links counts them.

let tmp = "";
let PASTA = "";
let CASOS = "";

/** A folder of its own for each reason the screen tests, with the files of its wire. */
const SMALL: Record<string, string[]> = {
  rota: ["servidor.ts", "metricas.ts"],
  ambigua: ["saude.ts", "svc_a.py", "svc_b.py"],
  nome: ["view.py", "render.ts"],
};

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

/**
 * One wire of each reason, among files at the root:
 * web.ts calls the same route with a config base and with a literal path (a joined wire, one link of each);
 * metricas.ts calls `/metrics`, which only `/:slug` matches; saude.ts calls `/health`, which two
 * services serve (their literal routes win over `/:slug`); view.py calls `render`, a name only TypeScript defines.
 * With `only`, just those files: a small folder whose wires fit on the screen.
 */
function makeCasos(root: string, only?: string[]): void {
  mkdirSync(root, { recursive: true });
  const write = (name: string, lines: string[]) => {
    if (only && !only.includes(name)) return;
    writeFileSync(join(root, name), [...lines, ""].join("\n"));
  };
  write("servidor.ts", [
    'import { Hono } from "hono";',
    "const app = new Hono();",
    'app.post("/api/frete", (c) => c.json({ valor: 10 }));',
    'app.get("/:slug", (c) => c.text("pagina"));',
  ]);
  write("web.ts", [
    'const config = { baseUrl: process.env.API_URL ?? "" };',
    "export function enviar(): void {",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the text of a TypeScript file, with its own template.
    '  fetch(`${config.baseUrl}/api/frete`, { method: "POST" });',
    "}",
    "export function pedir(): void {",
    '  fetch("/api/frete", { method: "POST" });',
    "}",
  ]);
  write("metricas.ts", [
    "export function medir(): void {",
    '  fetch("/metrics");',
    "}",
  ]);
  write("saude.ts", [
    "export function checar(): void {",
    '  fetch("/health");',
    "}",
  ]);
  for (const svc of ["svc_a", "svc_b"]) {
    write(`${svc}.py`, [
      "from fastapi import FastAPI",
      "app = FastAPI()",
      "",
      '@app.get("/health")',
      `def health_${svc}():`,
      '    return "ok"',
    ]);
  }
  write("view.py", ["def page():", "    return render(1)"]);
  write("render.ts", [
    "export function render(x: number): string {",
    "  return String(x);",
    "}",
  ]);
}

test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "8n8-a-conferir-"));
  PASTA = join(tmp, "conferir");
  makePasta(PASTA);
  CASOS = join(tmp, "casos");
  makeCasos(CASOS);
  for (const [name, files] of Object.entries(SMALL)) {
    makeCasos(join(tmp, name), files);
  }
});

test.afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const openFolder = async (page: Page, folder = PASTA, file = "web.ts") => {
  await page.goto("/");
  await page.getByLabel("Caminho da pasta").fill(folder);
  await page.getByRole("button", { name: "Mapear pasta" }).click();
  await expect(
    page.locator(`[aria-roledescription="node"][data-id="file:${file}"]`),
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

/** The skeleton of a folder, as the server gives it. */
const skeletonOf = async (page: Page, folder: string) =>
  (await (
    await page.request.post(`${OFFLINE}/api/project`, {
      data: { path: folder },
    })
  ).json()) as ProjectSkeleton;

/** The skeleton wire of calls from one file to another. */
const wireOf = (body: ProjectSkeleton, from: string, to: string) =>
  body.graph.edges.find(
    (e) =>
      e.kind === "calls" &&
      e.source === `file:${from}` &&
      e.target === `file:${to}`,
  );

test.describe("Ligação a conferir", () => {
  test("a call whose URL starts with a config value links with what to check; a literal one links proven", async ({
    page,
  }) => {
    const body = await skeletonOf(page, PASTA);
    expect(wireOf(body, "web.ts", "servidor.ts")?.toCheck).toEqual({
      reason: "dynamic-base",
      code: "config.baseUrl",
      path: "web.ts",
      line: 3,
    });
    expect(wireOf(body, "pedidos.ts", "servidor.ts")).toBeDefined();
    expect(wireOf(body, "pedidos.ts", "servidor.ts")?.toCheck).toBeUndefined();
  });

  test("the wire to check carries a mark on screen, and its tag says the reason, the value and the call", async ({
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
    await expect(check.locator(".wire-tag-kind")).toHaveText(
      "a conferir · URL de execução",
    );
    await expect(check).toContainText("config.baseUrl");
    await expect(check).toContainText("web.ts:3");
    await expect(page.locator(".wire-tag-links")).toHaveCount(0);
  });

  test("the proven wire has no check in its tag, and a link from TypeScript to TypeScript says across files", async ({
    page,
  }) => {
    await openFolder(page);
    const point = await middleOf(
      page,
      "Aresta de file:pedidos.ts para file:servidor.ts",
    );
    await page.mouse.move(point.x, point.y);
    await expect(page.locator(".wire-tag")).toBeVisible();
    await expect(page.locator(".wire-tag-check")).toHaveCount(0);
    await expect(page.locator(".wire-tag > .wire-tag-kind")).toHaveText(
      "Chama · entre arquivos",
    );
  });
});

test.describe("Ligação a conferir: cada motivo", () => {
  test("the skeleton says why each wire is to check, and counts the links of a joined wire", async ({
    page,
  }) => {
    const body = await skeletonOf(page, CASOS);

    const joined = wireOf(body, "web.ts", "servidor.ts");
    expect(joined?.links).toEqual({ proven: 1, toCheck: 1 });
    expect(joined?.toCheck?.reason).toBe("dynamic-base");

    expect(wireOf(body, "metricas.ts", "servidor.ts")?.toCheck).toEqual({
      reason: "param-route",
      path: "metricas.ts",
      line: 2,
    });

    // `/health` goes to both services, never to `/:slug`.
    for (const svc of ["svc_a.py", "svc_b.py"]) {
      expect(wireOf(body, "saude.ts", svc)?.toCheck).toEqual({
        reason: "ambiguous",
        targets: 2,
        path: "saude.ts",
        line: 2,
      });
    }
    expect(wireOf(body, "saude.ts", "servidor.ts")).toBeUndefined();

    expect(wireOf(body, "view.py", "render.ts")?.toCheck).toEqual({
      reason: "name-only",
      path: "view.py",
      line: 2,
    });
  });

  test("a joined wire says how many links it holds and that one is proven, and the mark shows on every wire to check", async ({
    page,
  }) => {
    await openFolder(page, CASOS);
    // web.ts, metricas.ts, two from saude.ts, and view.py.
    await expect(page.locator(".wire-check-mark")).toHaveCount(5);

    const point = await middleOf(
      page,
      "Aresta de file:web.ts para file:servidor.ts",
    );
    await page.mouse.move(point.x, point.y);
    await expect(page.locator(".wire-tag-links")).toHaveText(
      "2 ligações · 1 a conferir",
    );
    await expect(page.locator(".wire-tag-check")).toContainText(
      "Esta linha tem também 1 ligação provada.",
    );
  });

  for (const [folder, from, to, kind, at] of [
    [
      "rota",
      "metricas.ts",
      "servidor.ts",
      "a conferir · rota com parâmetro",
      "metricas.ts:2",
    ],
    [
      "ambigua",
      "saude.ts",
      "svc_a.py",
      "a conferir · ambígua (2 destinos)",
      "saude.ts:2",
    ],
    ["nome", "view.py", "render.ts", "a conferir · só pelo nome", "view.py:2"],
  ] as const) {
    test(`the tag of the wire from ${from} to ${to} says the reason in clear words and the call`, async ({
      page,
    }) => {
      await openFolder(page, join(tmp, folder), from);
      const point = await middleOf(
        page,
        `Aresta de file:${from} para file:${to}`,
      );
      await page.mouse.move(point.x, point.y);
      const check = page.locator(".wire-tag .wire-tag-check");
      await expect(check.locator(".wire-tag-kind")).toHaveText(kind);
      await expect(check).toContainText(at);
      // No value line: only the call.
      await expect(check.locator("dt")).toHaveCount(1);
    });
  }
});
