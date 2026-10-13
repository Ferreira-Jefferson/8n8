import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// Feature 02-pasta-local, end to end: real build, real server on 4317 with no key,
// real disk. The committed projeto-loja fixture is copied to a temp folder, plus
// what git does not keep: ignored folders, a file over 1 MB and a latin-1 file.

const FIXTURE = fileURLToPath(
  new URL(
    "../packages/extract-python/src/__tests__/fixtures/projeto-loja",
    import.meta.url,
  ),
);

let tmp = "";
let LOJA = "";

test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "code2n8n-pasta-local-"));
  LOJA = join(tmp, "loja");
  cpSync(FIXTURE, LOJA, { recursive: true });
  mkdirSync(join(LOJA, ".venv", "lib"), { recursive: true });
  writeFileSync(join(LOJA, ".venv", "lib", "x.py"), "def x():\n    return 1\n");
  mkdirSync(join(LOJA, "dist"), { recursive: true });
  writeFileSync(join(LOJA, "dist", "y.py"), "def y():\n    return 2\n");
  // 1.1 MB of valid UTF-8: over the 1 MB limit for size alone.
  const line = `# ${"a".repeat(98)}\n`;
  writeFileSync(
    join(LOJA, "grande.py"),
    line.repeat(Math.ceil((1.1 * 1024 * 1024) / line.length)),
  );
  // "# é" in latin-1: the 0xE9 byte alone is not valid UTF-8.
  writeFileSync(join(LOJA, "latin1.py"), Buffer.from([0x23, 0x20, 0xe9, 0x0a]));
});

test.afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const canvas = (page: Page) => page.getByRole("application");
const nodes = (page: Page) =>
  canvas(page).locator('[aria-roledescription="node"]');
const edges = (page: Page) =>
  canvas(page).locator('[aria-roledescription="edge"]');
const nodeById = (page: Page, id: string) =>
  canvas(page).locator(`[aria-roledescription="node"][data-id="${id}"]`);
const edge = (page: Page, from: string, to: string) =>
  canvas(page).getByRole("group", { name: `Edge from ${from} to ${to}` });
const breadcrumb = (page: Page) =>
  page.getByRole("navigation", { name: "Caminho de navegação" });

async function openFolder(page: Page, path: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Caminho da pasta").fill(path);
  await page.getByRole("button", { name: "Abrir pasta" }).click();
}

/** IDs of the nodes on the current level; none may come from an ignored file or folder (PROJ-01, 06). */
async function levelIds(page: Page): Promise<(string | null)[]> {
  const ids = await nodes(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-id")),
  );
  for (const id of ids) {
    expect(id).not.toMatch(/\.venv|dist|grande\.py|latin1\.py/);
  }
  return ids;
}

const PEDIDO = "file:pedidos/pedidos.py/fn:processar_pedido";
const FRETE = "file:frete/calculo.py/fn:calcular_frete";

test.describe("Pasta local", () => {
  test("PROJ-01/02: the top level is the four folders and pedidos holds its three files", async ({
    page,
  }) => {
    await openFolder(page, LOJA);

    await expect(nodes(page)).toHaveCount(4);
    expect(await levelIds(page)).toEqual([
      "dir:.",
      "dir:frete",
      "dir:legado",
      "dir:pedidos",
    ]);
    await expect(nodes(page).locator(".step-label")).toHaveText([
      "raiz",
      "frete",
      "legado",
      "pedidos",
    ]);
    await expect(breadcrumb(page).getByRole("button")).toHaveText(["loja"]);

    await nodeById(page, "dir:pedidos").dblclick();
    await expect(nodes(page)).toHaveCount(3);
    expect(await levelIds(page)).toEqual([
      "file:pedidos/__init__.py",
      "file:pedidos/itens.py",
      "file:pedidos/pedidos.py",
    ]);
    await expect(nodes(page).locator(".step-label")).toHaveText([
      "__init__.py",
      "itens.py",
      "pedidos.py",
    ]);

    await breadcrumb(page).getByRole("button", { name: "loja" }).click();
    await nodeById(page, "dir:.").dblclick();
    await expect(nodes(page)).toHaveCount(2);
    expect(await levelIds(page)).toEqual(["file:main.py", "file:relatorio.py"]);
  });

  test("PROJ-03, Independent Test: import wires join the folders and, inside pedidos, the files", async ({
    page,
  }) => {
    await openFolder(page, LOJA);

    await expect(nodes(page)).toHaveCount(4);
    await expect(edges(page)).toHaveCount(2);
    await expect(edge(page, "dir:pedidos", "dir:frete")).toHaveCount(1);
    await expect(edge(page, "dir:.", "dir:pedidos")).toHaveCount(1);
    await expect(edge(page, "dir:pedidos", "dir:frete")).toHaveClass(
      /\bedge-imports\b/,
    );
    await expect(edge(page, "dir:.", "dir:pedidos")).toHaveClass(
      /\bedge-imports\b/,
    );

    await nodeById(page, "dir:pedidos").dblclick();
    await expect(nodes(page)).toHaveCount(3);
    await levelIds(page);
    await expect(edges(page)).toHaveCount(1);
    await expect(
      edge(page, "file:pedidos/pedidos.py", "file:pedidos/itens.py"),
    ).toHaveCount(1);
  });

  test("PROJ-04, Independent Test: the calcular_frete step jumps to frete › calculo.py › calcular_frete", async ({
    page,
  }) => {
    await openFolder(page, LOJA);
    await nodeById(page, "dir:pedidos").dblclick();
    await nodeById(page, "file:pedidos/pedidos.py").dblclick();
    await expect(nodes(page)).toHaveCount(1);
    await levelIds(page);
    await nodeById(page, PEDIDO).dblclick();

    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "loja",
      "pedidos",
      "pedidos.py",
      "processar_pedido",
    ]);
    await levelIds(page);
    const step = nodeById(page, `${PEDIDO}/s1`);
    await expect(step.locator(".step-label")).toHaveText("calcular_frete");

    await step.dblclick();
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "loja",
      "frete",
      "calculo.py",
      "calcular_frete",
    ]);
    await expect(nodes(page)).toHaveCount(3);
    expect(await levelIds(page)).toEqual([
      `${FRETE}/s0`,
      `${FRETE}/s0/b0/s0`,
      `${FRETE}/s1`,
    ]);
  });

  test("PROJ-09: calcular_frete without an import is EXTERNO and the same name in legado gets no wire", async ({
    page,
  }) => {
    await openFolder(page, LOJA);
    await nodeById(page, "dir:.").dblclick();
    await nodeById(page, "file:relatorio.py").dblclick();
    await nodeById(page, "file:relatorio.py/fn:gerar").dblclick();
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "loja",
      "raiz",
      "relatorio.py",
      "gerar",
    ]);
    await levelIds(page);
    const step = nodeById(page, "file:relatorio.py/fn:gerar/s0");
    await expect(step.locator(".step-label")).toHaveText("calcular_frete");
    await expect(step.locator(".step-category")).toHaveText("EXTERNO");

    await breadcrumb(page).getByRole("button", { name: "loja" }).click();
    await nodeById(page, "dir:legado").dblclick();
    await nodeById(page, "file:legado/frete_antigo.py").dblclick();
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "loja",
      "legado",
      "frete_antigo.py",
    ]);
    await expect(nodes(page)).toHaveCount(1);
    expect(await levelIds(page)).toEqual([
      "file:legado/frete_antigo.py/fn:calcular_frete",
    ]);
    await expect(edges(page)).toHaveCount(0);
  });

  test("PROJ-05: a missing path and a file path both say Pasta não encontrada", async ({
    page,
  }) => {
    for (const path of [join(tmp, "nao-existe"), join(LOJA, "main.py")]) {
      await openFolder(page, path);
      await expect(page.getByRole("alert")).toHaveText(
        `Pasta não encontrada: ${path}`,
      );
      await expect(nodes(page)).toHaveCount(0);
    }
  });
});
