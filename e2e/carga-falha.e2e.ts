import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, type Request, test } from "./test";

// A file that fails to load shows the failure with a retry button, and the
// browser drops the files it opened long ago. Real build, real server, real disk.

const FIXTURE = fileURLToPath(
  new URL(
    "../packages/languages/python/src/__tests__/fixtures/projeto-loja",
    import.meta.url,
  ),
);

let tmp = "";
test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "8n8-carga-falha-"));
});
test.afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function copyLoja(name: string): string {
  const loja = join(tmp, name);
  cpSync(FIXTURE, loja, { recursive: true });
  return loja;
}

const canvas = (page: Page) => page.getByRole("application");
const nodeById = (page: Page, id: string) =>
  canvas(page).locator(`[aria-roledescription="node"][data-id="${id}"]`);

async function clickCard(page: Page, id: string): Promise<void> {
  const card = nodeById(page, id);
  await expect(card).toBeVisible();
  await card.dispatchEvent("click");
}

async function openFolder(page: Page, path: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Caminho da pasta").fill(path);
  await page.getByRole("button", { name: "Mapear pasta" }).click();
}

const isFileRequest = (r: Request) =>
  r.url().endsWith("/api/project/file") && r.method() === "POST";

const FRETE = "file:frete/calculo.py/fn:calcular_frete";
const FAILED = "Não foi possível carregar o arquivo.";

test.describe("Carga com falha e limite de memória", () => {
  test("a file level that fails shows the message and a button that loads it", async ({
    page,
  }) => {
    const loja = copyLoja("nivel");
    let failing = true;
    let calls = 0;
    await page.route("**/api/project/file", (route) => {
      calls += 1;
      return failing ? route.abort() : route.continue();
    });
    await openFolder(page, loja);
    await clickCard(page, "dir:frete");
    await clickCard(page, "file:frete/calculo.py");

    // One try and one retry, then the failure shows in place of the loading text.
    // The hub is selected, so the panel says it too: the canvas message comes first.
    await expect(page.getByText(FAILED).first()).toBeVisible();
    await expect(page.getByText("Carregando o arquivo…")).toHaveCount(0);
    expect(calls).toBe(2);
    await page.screenshot({ path: test.info().outputPath("erro-canvas.png") });

    failing = false;
    await page.getByRole("button", { name: "Tentar de novo" }).first().click();
    await expect(nodeById(page, FRETE)).toBeVisible();
    await expect(page.getByText(FAILED)).toHaveCount(0);
    expect(calls).toBe(3);
  });

  test("the panel of a file that fails shows the message and the button, in place of loading", async ({
    page,
  }) => {
    const loja = copyLoja("painel");
    let failing = true;
    await page.route("**/api/project/file", (route) =>
      failing ? route.abort() : route.continue(),
    );
    await openFolder(page, loja);
    await clickCard(page, "dir:frete");
    await nodeById(page, "file:frete/calculo.py")
      .getByRole("button", { name: "Ver detalhes do nó" })
      .click();
    const panel = page.getByRole("complementary", { name: "Detalhe do nó" });
    await expect(panel.getByText(FAILED)).toBeVisible();
    await expect(panel.getByText("Carregando o código…")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("erro-painel.png") });

    failing = false;
    await panel.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(panel).toContainText("def calcular_frete");
    await expect(panel.getByText(FAILED)).toHaveCount(0);
  });

  test("with a tiny limit, a file opened long ago is dropped and asked again; the one on screen stays", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as { __8n8MaxNodes?: number }).__8n8MaxNodes = 1;
    });
    const loja = copyLoja("limite");
    const paths: string[] = [];
    page.on("request", (r) => {
      if (isFileRequest(r)) paths.push(r.postDataJSON().path);
    });
    await openFolder(page, loja);
    await clickCard(page, "dir:frete");
    await clickCard(page, "file:frete/calculo.py");
    await expect(nodeById(page, FRETE)).toBeVisible();
    expect(paths).toEqual(["frete/calculo.py"]);

    // Back to the root and look at another file: it passes the limit, and calculo.py is not on screen.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await clickCard(page, "dir:pedidos");
    await nodeById(page, "file:pedidos/itens.py")
      .getByRole("button", { name: "Ver detalhes do nó" })
      .click();
    await expect.poll(() => paths).toContain("pedidos/itens.py");

    // Opening calculo.py again asks for it again, and it stays while it is the level.
    await page.keyboard.press("Escape");
    await clickCard(page, "dir:frete");
    await clickCard(page, "file:frete/calculo.py");
    await expect(nodeById(page, FRETE)).toBeVisible();
    expect(paths.filter((p) => p === "frete/calculo.py")).toHaveLength(2);
    await page.waitForTimeout(500);
    expect(paths.filter((p) => p === "frete/calculo.py")).toHaveLength(2);
    await expect(nodeById(page, FRETE)).toBeVisible();
  });
});
