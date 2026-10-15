import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  GraphResponse,
  LanguagesResponse,
  ProjectResponse,
} from "@code2n8n/model";
import { expect, type Page, test } from "@playwright/test";
import { OFFLINE } from "./mapa";

// Feature 06-multilinguagem, end to end: real server on 4317 with no key, real disk.
// The language of a snippet comes from the server, a folder of two languages is one
// graph, and a file of one language that calls a file of the other is wired to it.

const PY_SNIPPET = `def calcular_frete(peso):
    if peso > 10:
        return 25
    return 10
`;

const TS_SNIPPET = `export function calcularFrete(peso: number): number {
  if (peso > 10) {
    return 25;
  }
  return 10;
}
`;

let tmp = "";
let MISTA = "";

/** a.py asks a route that servidor.ts offers, runs ferramenta.ts and calls somarTotal, which lib.ts defines. */
function makeMista(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "cliente.py"),
    [
      "import requests",
      "import subprocess",
      "",
      "def pedir_frete(peso):",
      '    return requests.post("http://localhost:3000/api/frete", json={"peso": peso})',
      "",
      "def rodar_ferramenta():",
      '    subprocess.run(["node", "ferramenta.ts"])',
      "",
      "def fechar_conta(itens):",
      "    return somarTotal(itens)",
      "",
    ].join("\n"),
  );
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
    join(root, "ferramenta.ts"),
    [
      "export function limpar(): void {",
      '  console.log("limpo");',
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "lib.ts"),
    [
      "export function somarTotal(itens: number[]): number {",
      "  return itens.reduce((a, b) => a + b, 0);",
      "}",
      "",
    ].join("\n"),
  );
}

test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "code2n8n-multilinguagem-"));
  MISTA = join(tmp, "mista");
  makeMista(MISTA);
});

test.afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const postJson = (page: Page, path: string, body: unknown) =>
  page.request.post(`${OFFLINE}${path}`, { data: body });

test.describe("Multilinguagem", () => {
  test("lists the languages the server reads, with their extensions", async ({
    page,
  }) => {
    const res = await page.request.get(`${OFFLINE}/api/languages`);

    expect(res.status()).toBe(200);
    const { languages } = (await res.json()) as LanguagesResponse;
    expect(languages.map((l) => l.id)).toEqual(["python", "typescript"]);
    expect(languages.find((l) => l.id === "python")?.extensions).toEqual([
      ".py",
    ]);
    expect(languages.find((l) => l.id === "typescript")?.extensions).toContain(
      ".ts",
    );
  });

  test("a Python snippet is told apart from a TypeScript one, with no extension to help", async ({
    page,
  }) => {
    const py = (await (
      await postJson(page, "/api/graph", { source: PY_SNIPPET })
    ).json()) as GraphResponse;
    const ts = (await (
      await postJson(page, "/api/graph", { source: TS_SNIPPET })
    ).json()) as GraphResponse;

    expect(py.language).toMatchObject({ id: "python", uncertain: false });
    expect(py.graph.language).toBe("python");
    expect(ts.language).toMatchObject({ id: "typescript", uncertain: false });
    expect(ts.graph.language).toBe("typescript");
    expect(py.graph.nodes.map((n) => n.id)).toContain("fn:calcular_frete");
    expect(ts.graph.nodes.map((n) => n.id)).toContain("fn:calcularFrete");
  });

  test("a snippet that fits both languages is flagged as uncertain", async ({
    page,
  }) => {
    const res = (await (
      await postJson(page, "/api/graph", { source: "x = 1\n" })
    ).json()) as GraphResponse;

    expect(res.language.uncertain).toBe(true);
  });

  test("the screen names the language of the snippet it mapped", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Colar trecho/ }).click();
    await page.getByLabel("Trecho de código").fill(TS_SNIPPET);
    await page.getByRole("button", { name: "Gerar mapa" }).click();

    await expect(page.locator(".snippet-language")).toHaveText("TypeScript");
  });

  test("the screen warns when it is not sure of the language", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Colar trecho/ }).click();
    await page.getByLabel("Trecho de código").fill("x = 1\n");
    await page.getByRole("button", { name: "Gerar mapa" }).click();

    await expect(page.locator(".snippet-language")).toContainText(
      "Linguagem incerta. Mostrando como",
    );
  });

  test("a folder of two languages is one graph, named mixed, with files of both", async ({
    page,
  }) => {
    const res = await postJson(page, "/api/project", { path: MISTA });

    expect(res.status()).toBe(200);
    const body = (await res.json()) as ProjectResponse;
    expect(body.graph.language).toBe("mixed");
    const files = body.graph.nodes
      .filter((n) => n.kind === "file")
      .map((n) => n.path);
    expect(files).toEqual(
      expect.arrayContaining([
        "cliente.py",
        "servidor.ts",
        "ferramenta.ts",
        "lib.ts",
      ]),
    );
    expect(body.ignored).toEqual([]);
  });

  test("a Python file that calls a TypeScript route is wired to it, with the channel on the wire", async ({
    page,
  }) => {
    const body = (await (
      await postJson(page, "/api/project", { path: MISTA })
    ).json()) as ProjectResponse;

    const wire = body.graph.edges.find(
      (e) => e.kind === "calls" && e.label === "HTTP POST /api/frete",
    );

    expect(wire).toBeDefined();
    expect(wire?.source).toContain("cliente.py");
    expect(wire?.target).toContain("servidor.ts");
  });

  test("a Python file that runs a TypeScript file is wired to it by path", async ({
    page,
  }) => {
    const body = (await (
      await postJson(page, "/api/project", { path: MISTA })
    ).json()) as ProjectResponse;

    const wire = body.graph.edges.find(
      (e) => e.kind === "calls" && e.label === "processo",
    );

    expect(wire?.source).toContain("cliente.py");
    expect(wire?.target).toContain("ferramenta.ts");
  });

  test("a Python call to a name only TypeScript defines is wired by name", async ({
    page,
  }) => {
    const body = (await (
      await postJson(page, "/api/project", { path: MISTA })
    ).json()) as ProjectResponse;

    const wire = body.graph.edges.find(
      (e) => e.kind === "calls" && e.label === "nome",
    );

    expect(wire?.source).toContain("cliente.py");
    expect(wire?.target).toContain("lib.ts");
  });

  test("the folder opens on screen with the files of both languages at the top", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Caminho da pasta").fill(MISTA);
    await page.getByRole("button", { name: "Mapear pasta" }).click();

    for (const file of [
      "cliente.py",
      "servidor.ts",
      "ferramenta.ts",
      "lib.ts",
    ]) {
      await expect(
        page.locator(`[aria-roledescription="node"][data-id="file:${file}"]`),
      ).toBeVisible();
    }
  });

  test("a folder with no file of any known language says so", async ({
    page,
  }) => {
    const vazia = join(tmp, "vazia");
    mkdirSync(vazia, { recursive: true });
    writeFileSync(join(vazia, "notas.txt"), "oi");

    await page.goto("/");
    await page.getByLabel("Caminho da pasta").fill(vazia);
    await page.getByRole("button", { name: "Mapear pasta" }).click();

    await expect(
      page.getByText(/Nenhum arquivo .* encontrado na pasta/),
    ).toBeVisible();
  });
});
