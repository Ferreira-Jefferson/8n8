import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FileDetail, ProjectSkeleton, SearchHit } from "@8n8/model";
import { OFFLINE } from "./mapa";
import { expect, type Page, type Request, type Response, test } from "./test";

// On-demand loading, end to end: the folder comes as a skeleton (folders, files, the
// wires between files and the counts), the inside of a file comes when the file opens,
// and a search reaches files nobody opened. Real build, real server, real disk.

const FIXTURE = fileURLToPath(
  new URL(
    "../packages/languages/python/src/__tests__/fixtures/projeto-loja",
    import.meta.url,
  ),
);

let tmp = "";
test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "8n8-sob-demanda-"));
});
test.afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/** A fresh copy of the fixture, so a test can change it on disk. */
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

test.describe("Carga sob demanda", () => {
  test("the folder answers a skeleton with no source, and a file is asked for once, when it opens, with the version of the skeleton", async ({
    page,
  }) => {
    const loja = copyLoja("esqueleto");
    const fileRequests: { path: string; version: string }[] = [];
    page.on("request", (r) => {
      if (isFileRequest(r)) fileRequests.push(r.postDataJSON());
    });
    const project = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/project") && r.request().method() === "POST",
    );
    await openFolder(page, loja);
    const skeleton = (await (await project).json()) as ProjectSkeleton & {
      files?: unknown;
    };

    expect(skeleton.files).toBeUndefined();
    expect(new Set(skeleton.graph.nodes.map((n) => n.kind))).toEqual(
      new Set(["folder", "file"]),
    );
    expect(skeleton.stats.files).toBe(
      skeleton.graph.nodes.filter((n) => n.kind === "file").length,
    );
    expect(skeleton.stats.nodes).toBeGreaterThan(skeleton.graph.nodes.length);
    // Each file says how many nodes its level shows, before its inside comes.
    const calculo = skeleton.graph.nodes.find(
      (n) => n.id === "file:frete/calculo.py",
    );
    expect(calculo?.size).toBeGreaterThan(0);

    await expect(canvas(page)).toBeVisible();
    await expect(nodeById(page, "dir:frete")).toBeVisible();
    expect(fileRequests).toEqual([]);

    const detail = page.waitForResponse(isFileResponse);
    await clickCard(page, "dir:frete");
    await expect(nodeById(page, "file:frete/calculo.py")).toBeVisible();
    // A closed file is a card with no request yet.
    expect(fileRequests).toEqual([]);

    await clickCard(page, "file:frete/calculo.py");
    const body = (await (await detail).json()) as FileDetail;
    expect(body.path).toBe("frete/calculo.py");
    expect(body.nodes.map((n) => n.id)).toContain(FRETE);
    await expect(nodeById(page, FRETE)).toBeVisible();
    expect(fileRequests).toEqual([
      { root: loja, path: "frete/calculo.py", version: skeleton.version },
    ]);

    // Back and open again: the file is already here.
    await page.keyboard.press("Escape");
    await clickCard(page, "file:frete/calculo.py");
    await expect(nodeById(page, FRETE)).toBeVisible();
    expect(fileRequests).toHaveLength(1);
  });

  test("a file selected without being opened brings its code for the panel", async ({
    page,
  }) => {
    const loja = copyLoja("ver-sem-abrir");
    await openFolder(page, loja);
    await clickCard(page, "dir:frete");
    const detail = page.waitForResponse(isFileResponse);
    await nodeById(page, "file:frete/calculo.py")
      .getByRole("button", { name: "Ver detalhes do nó" })
      .click();
    expect(((await (await detail).json()) as FileDetail).path).toBe(
      "frete/calculo.py",
    );
    await expect(
      page.getByRole("complementary", { name: "Detalhe do nó" }),
    ).toContainText("def calcular_frete");
  });

  test("a search finds a function of a file nobody opened, loads the file and goes to it", async ({
    page,
  }) => {
    const loja = copyLoja("busca");
    const fileRequests: Request[] = [];
    page.on("request", (r) => {
      if (isFileRequest(r)) fileRequests.push(r);
    });
    const search = page.waitForResponse((r) =>
      r.url().endsWith("/api/project/search"),
    );
    await openFolder(page, loja);
    await expect(canvas(page)).toBeVisible();
    await page.getByRole("button", { name: "Buscar nó" }).click();
    await page
      .getByRole("combobox", { name: "Buscar nó" })
      .fill("calcular_frete");
    const { hits } = (await (await search).json()) as { hits: SearchHit[] };
    expect(hits.map((h) => h.node.id)).toContain(FRETE);
    expect(hits.find((h) => h.node.id === FRETE)?.ancestry).toEqual([
      "dir:frete",
      "file:frete/calculo.py",
    ]);
    expect(fileRequests).toHaveLength(0);

    await page.getByRole("option").filter({ hasText: "calculo.py" }).click();
    await expect(nodeById(page, FRETE)).toBeVisible();
    expect(fileRequests).toHaveLength(1);
    await expect(
      page
        .getByRole("navigation", { name: "Caminho de navegação" })
        .getByRole("button"),
    ).toHaveText(["busca", "frete", "calculo.py"]);
  });

  test("a folder that changed after its map opened is read again by itself when a file opens, with no error", async ({
    page,
  }) => {
    const loja = copyLoja("mudou");
    const dois = copyLoja("outra-1");
    const tres = copyLoja("outra-2");
    const projects: Request[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/project") && r.method() === "POST") {
        projects.push(r);
      }
    });
    await openFolder(page, loja);
    await expect(nodeById(page, "dir:frete")).toBeVisible();
    expect(projects).toHaveLength(1);

    // Two other folders push this build out of the server's small memory; then the folder changes.
    for (const other of [dois, tres]) {
      const res = await page.request.post(`${OFFLINE}/api/project`, {
        data: { path: other },
      });
      expect(res.status()).toBe(200);
    }
    appendFileSync(
      join(loja, "frete", "calculo.py"),
      "\n\ndef calcular_depois():\n    return 7\n",
    );
    // The folder the page asks about is the one it had open: its own pages already cost a read.
    writeFileSync(join(loja, "extra.py"), "def extra():\n    return 1\n");

    await clickCard(page, "dir:frete");
    await clickCard(page, "file:frete/calculo.py");

    // The 409 reopens the folder: a second request for it, no alert, a map again.
    await expect.poll(() => projects.length).toBe(2);
    expect(projects[1]?.postDataJSON()).toMatchObject({ path: loja });
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(canvas(page)).toBeVisible();
    await expect(nodeById(page, "file:extra.py")).toBeVisible();

    // The new build has the change.
    await clickCard(page, "dir:frete");
    await clickCard(page, "file:frete/calculo.py");
    await expect(
      nodeById(page, "file:frete/calculo.py/fn:calcular_depois"),
    ).toBeVisible();
  });
});

function isFileResponse(r: Response): boolean {
  return isFileRequest(r.request());
}
