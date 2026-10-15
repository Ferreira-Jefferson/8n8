import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectResponse } from "@8n8/model";
import { expect, type Page, test } from "@playwright/test";

// Feature 02-pasta-local, end to end: real build, real server on 4317 with no key,
// real disk. The committed projeto-loja fixture is copied to a temp folder, plus
// what git does not keep: ignored folders, a file over 1 MB and a latin-1 file.
// Feature 05: one click opens a node, and cards show a tag and a provisional name.

const FIXTURE = fileURLToPath(
  new URL(
    "../packages/languages/python/src/__tests__/fixtures/projeto-loja",
    import.meta.url,
  ),
);

let tmp = "";
let LOJA = "";

/** Copies the fixture to `loja` and adds the files git does not keep. */
function makeLoja(loja: string): void {
  cpSync(FIXTURE, loja, { recursive: true });
  mkdirSync(join(loja, ".venv", "lib"), { recursive: true });
  writeFileSync(join(loja, ".venv", "lib", "x.py"), "def x():\n    return 1\n");
  mkdirSync(join(loja, "dist"), { recursive: true });
  writeFileSync(join(loja, "dist", "y.py"), "def y():\n    return 2\n");
  // 1.1 MB of valid UTF-8: over the 1 MB limit for size alone.
  const line = `# ${"a".repeat(98)}\n`;
  writeFileSync(
    join(loja, "grande.py"),
    line.repeat(Math.ceil((1.1 * 1024 * 1024) / line.length)),
  );
  // "# é" in latin-1: the 0xE9 byte alone is not valid UTF-8.
  writeFileSync(join(loja, "latin1.py"), Buffer.from([0x23, 0x20, 0xe9, 0x0a]));
}

test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "8n8-pasta-local-"));
  LOJA = join(tmp, "loja");
  makeLoja(LOJA);
});

test.afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const canvas = (page: Page) => page.getByRole("application");
const nodes = (page: Page) =>
  canvas(page).locator('[aria-roledescription="node"]:not(.hub-node)');
const edges = (page: Page) =>
  canvas(page).locator('[aria-roledescription="edge"]:not(.edge-contains)');
const nodeById = (page: Page, id: string) =>
  canvas(page).locator(`[aria-roledescription="node"][data-id="${id}"]`);
const edge = (page: Page, from: string, to: string) =>
  canvas(page).getByRole("group", { name: `Edge from ${from} to ${to}` });
const breadcrumb = (page: Page) =>
  page.getByRole("navigation", { name: "Caminho de navegação" });
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Detalhe do nó" });
/** The card titles of the level, without the "›" open mark, in DOM order (VID-15). */
const cardNames = (page: Page) =>
  nodes(page).evaluateAll((els) =>
    els.map((el) => el.querySelector(".name")?.firstChild?.textContent ?? null),
  );

/** Clicks a card even when the zoom leaves it off-screen; it must be visible first. */
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
  test("PROJ-01/02: the top level is the three folders and the two root files, and pedidos holds its three files", async ({
    page,
  }) => {
    await openFolder(page, LOJA);

    await expect(nodes(page)).toHaveCount(5);
    expect(await levelIds(page)).toEqual([
      "dir:frete",
      "dir:legado",
      "dir:pedidos",
      "file:main.py",
      "file:relatorio.py",
    ]);
    await expect
      .poll(() => cardNames(page))
      .toEqual(["frete", "legado", "pedidos", "main.py", "relatorio.py"]);
    await expect(breadcrumb(page).getByRole("button")).toHaveText(["loja"]);

    await clickCard(page, "dir:pedidos");
    await expect(nodes(page)).toHaveCount(3);
    expect(await levelIds(page)).toEqual([
      "file:pedidos/__init__.py",
      "file:pedidos/itens.py",
      "file:pedidos/pedidos.py",
    ]);
    await expect
      .poll(() => cardNames(page))
      .toEqual(["__init__.py", "itens.py", "pedidos.py"]);

    await breadcrumb(page).getByRole("button", { name: "loja" }).click();
    await expect(nodes(page)).toHaveCount(5);
  });

  test("PROJ-03, Independent Test: import wires join the folders and, inside pedidos, the files", async ({
    page,
  }) => {
    await openFolder(page, LOJA);

    await expect(nodes(page)).toHaveCount(5);
    await expect(edges(page)).toHaveCount(2);
    await expect(edge(page, "dir:pedidos", "dir:frete")).toHaveCount(1);
    await expect(edge(page, "file:main.py", "dir:pedidos")).toHaveCount(1);
    await expect(edge(page, "dir:pedidos", "dir:frete")).toHaveClass(
      /\bedge-imports\b/,
    );
    await expect(edge(page, "file:main.py", "dir:pedidos")).toHaveClass(
      /\bedge-imports\b/,
    );

    await clickCard(page, "dir:pedidos");
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
    await clickCard(page, "dir:pedidos");
    await clickCard(page, "file:pedidos/pedidos.py");
    await expect(nodes(page)).toHaveCount(1);
    await levelIds(page);
    await clickCard(page, PEDIDO);

    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "loja",
      "pedidos",
      "pedidos.py",
      "Processar pedido",
    ]);
    await levelIds(page);
    const step = nodeById(page, `${PEDIDO}/s1`);
    await expect(step.locator(".name")).toHaveAttribute(
      "title",
      "Calcular frete",
    );
    await expect(step.locator("[data-tag]")).toHaveAttribute(
      "data-tag",
      "FUNÇÃO",
    );

    await clickCard(page, `${PEDIDO}/s1`);
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "loja",
      "frete",
      "calculo.py",
      "Calcular frete",
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
    const project = page.waitForResponse("**/api/project");
    await openFolder(page, LOJA);
    const { graph } = (await (await project).json()) as ProjectResponse;
    await clickCard(page, "file:relatorio.py");
    await clickCard(page, "file:relatorio.py/fn:gerar");
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "loja",
      "relatorio.py",
      "Gerar",
    ]);
    await levelIds(page);
    // `return calcular_frete(10)` is a RETORNO step (VID-20); the call it holds
    // is EXTERNO, with no target and no calls wire (PROJ-09).
    const STEP = "file:relatorio.py/fn:gerar/s0";
    const node = graph.nodes.find((n) => n.id === STEP);
    expect(node?.kind).toBe("return");
    expect(node?.callee).toBe("calcular_frete");
    expect(node?.category).toBe("EXTERNO");
    expect(node?.target).toBeUndefined();
    expect(
      graph.edges.filter(
        (e) => e.kind === "calls" && e.source.startsWith("file:relatorio.py"),
      ),
    ).toEqual([]);
    const step = nodeById(page, STEP);
    await expect(step.locator("[data-tag]")).toHaveAttribute(
      "data-tag",
      "RETORNO",
    );
    await expect(step.locator(".fn")).toHaveText("return calcular_frete(10)");

    await breadcrumb(page).getByRole("button", { name: "loja" }).click();
    await clickCard(page, "dir:legado");
    await clickCard(page, "file:legado/frete_antigo.py");
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

  test("PROJ-06, CLEAN-04/05: an icon whose hover counts the ignored files; a click lists grande.py and latin1.py, beside the panel", async ({
    page,
  }) => {
    await openFolder(page, LOJA);
    await expect(nodes(page)).toHaveCount(5);
    const section = page.getByRole("region", { name: "Arquivos ignorados" });
    await expect(section).toHaveCount(0);

    const icon = page.getByRole("button", { name: "2 arquivos ignorados" });
    const tip = icon.locator(".ignored-tip");
    await expect(tip).toBeHidden();
    await icon.hover();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText("2 arquivos ignorados");

    await clickCard(page, "file:main.py");
    await expect(panel(page)).toBeVisible();
    await icon.click();
    await expect(section.locator(".ignored-path")).toHaveText([
      "grande.py",
      "latin1.py",
    ]);
    await expect(section.locator(".ignored-reason")).toHaveText([
      "maior que 1 MB",
      "não está em UTF-8",
    ]);
    await expect(page.getByText(/\b[xy]\.py\b/)).toHaveCount(0);
    // The list never covers the detail panel (CLEAN-05).
    const list = await section.boundingBox();
    const side = await panel(page).boundingBox();
    expect(list && side && list.x + list.width <= side.x).toBe(true);
  });

  test("CLEAN-06: Adicionar ao mapa puts grande.py on the map and takes it off the list; latin1.py has no such button", async ({
    page,
  }) => {
    await openFolder(page, LOJA);
    await expect(nodes(page)).toHaveCount(5);
    await page.getByRole("button", { name: "2 arquivos ignorados" }).click();
    const section = page.getByRole("region", { name: "Arquivos ignorados" });
    const add = section.getByRole("button", { name: "Adicionar ao mapa" });
    await expect(add).toHaveCount(1);
    await expect(
      section
        .locator("li", {
          has: page.getByRole("button", { name: "Adicionar ao mapa" }),
        })
        .locator(".ignored-path"),
    ).toHaveText("grande.py");

    const sent = page.waitForRequest("**/api/project");
    await add.click();
    expect((await sent).postDataJSON()).toEqual({
      path: LOJA,
      include: ["grande.py"],
    });
    await expect(nodeById(page, "file:grande.py")).toBeVisible();
    await expect(nodes(page)).toHaveCount(6);
    await expect(
      page.getByRole("button", { name: "1 arquivo ignorado" }),
    ).toBeVisible();
  });

  test("CLEAN-01/02: what the .gitignore of the folder or of a subfolder ignores is neither on the map nor on the list", async ({
    page,
  }) => {
    const loja = join(tmp, "com-gitignore", "loja");
    makeLoja(loja);
    writeFileSync(join(loja, ".gitignore"), "gerado/\n*.log.py\nlatin1.py\n");
    mkdirSync(join(loja, "gerado"), { recursive: true });
    writeFileSync(join(loja, "gerado", "z.py"), "def z():\n    return 3\n");
    writeFileSync(
      join(loja, "gerado", "grande2.py"),
      Buffer.alloc(1_200_000, 35),
    );
    writeFileSync(join(loja, "rodada.log.py"), "def w():\n    return 4\n");
    // A nested .gitignore, with a ! that brings one file back.
    writeFileSync(join(loja, "pedidos", ".gitignore"), "*.py\n!pedidos.py\n");

    await openFolder(page, loja);
    await expect(nodes(page)).toHaveCount(5);
    const top = await levelIds(page);
    expect(top.join(" ")).not.toMatch(/gerado|rodada/);
    await clickCard(page, "dir:pedidos");
    await expect
      .poll(() => levelIds(page))
      .toEqual(["file:pedidos/pedidos.py"]);

    // Only grande.py is left out: latin1.py, gerado/ and its large file are the project's choice.
    const icon = page.getByRole("button", { name: "1 arquivo ignorado" });
    await icon.click();
    await expect(
      page
        .getByRole("region", { name: "Arquivos ignorados" })
        .locator(".ignored-path"),
    ).toHaveText(["grande.py"]);
  });

  test("PROJ-07: mapping, drilling, jumping and opening a panel leave the folder untouched", async ({
    page,
  }) => {
    // A fresh copy that no test has read: "before" precedes the first read,
    // so even a write that gives the same result every time is caught.
    const loja = join(tmp, "fresca", "loja");
    makeLoja(loja);
    const before = fingerprint(loja);
    expect(before.map((f) => f.path)).toEqual([
      ".venv/lib/x.py",
      "dist/y.py",
      "frete/__init__.py",
      "frete/calculo.py",
      "grande.py",
      "latin1.py",
      "legado/frete_antigo.py",
      "main.py",
      "pedidos/__init__.py",
      "pedidos/itens.py",
      "pedidos/pedidos.py",
      "relatorio.py",
    ]);

    await openFolder(page, loja);
    await clickCard(page, "dir:pedidos");
    await clickCard(page, "file:pedidos/pedidos.py");
    await clickCard(page, PEDIDO);
    await clickCard(page, `${PEDIDO}/s1`);
    await expect(breadcrumb(page).getByRole("button")).toHaveText([
      "loja",
      "frete",
      "calculo.py",
      "Calcular frete",
    ]);
    await breadcrumb(page).getByRole("button", { name: "calculo.py" }).click();
    await clickCard(page, FRETE);
    await expect(
      panel(page).getByText("Configure um provedor de LLM em Configurações."),
    ).toHaveCount(2);

    expect(fingerprint(loja)).toEqual(before);
  });

  test("PROJ-08: the server refuses a connection on the machine's external IPv4", async () => {
    const ipv4 = Object.values(networkInterfaces())
      .flat()
      .find((a) => a !== undefined && a.family === "IPv4" && !a.internal);
    test.skip(ipv4 === undefined, "sem IPv4 externo");
    const outcome = await new Promise<string>((resolve) => {
      const socket = connect({ host: ipv4?.address, port: 4317 });
      socket.on("connect", () => {
        socket.destroy();
        resolve("connected");
      });
      socket.on("error", (err: NodeJS.ErrnoException) =>
        resolve(err.code ?? err.message),
      );
    });
    expect(outcome).toBe("ECONNREFUSED");
  });

  test("AD-015: a project node is explained by root and nodeId, and the panel shows its file and lines", async ({
    page,
  }) => {
    const bodies: unknown[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/summary")) bodies.push(r.postDataJSON());
    });

    await openFolder(page, LOJA);
    await clickCard(page, "dir:frete");
    await clickCard(page, "file:frete/calculo.py");
    await clickCard(page, FRETE);

    const view = panel(page);
    await expect(
      view.getByText("Configure um provedor de LLM em Configurações.", {
        exact: true,
      }),
    ).toHaveCount(2);
    expect(bodies).toEqual([{ root: LOJA, nodeId: FRETE }]);
    await expect(
      view.getByText("CÓDIGO · frete/calculo.py, linhas 1 a 4", {
        exact: true,
      }),
    ).toHaveCount(1);
    expect(
      await view
        .locator("[data-line]")
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-line"))),
    ).toEqual(["1", "2", "3", "4"]);
    await expect(view.locator("[data-line] code")).toHaveText([
      "def calcular_frete(peso):",
      "    if peso > 30:",
      "        return 50",
      "    return 20",
    ]);
  });
});

interface FileStamp {
  path: string;
  size: number;
  mtimeMs: number;
  sha256: string;
}

/** Relative path, size, mtime and sha256 of every file under `root`, in path order (PROJ-07). */
function fingerprint(root: string): FileStamp[] {
  const out: FileStamp[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      const abs = join(root, path);
      const { size, mtimeMs } = statSync(abs);
      const sha256 = createHash("sha256")
        .update(readFileSync(abs))
        .digest("hex");
      out.push({ path, size, mtimeMs, sha256 });
    }
  };
  walk("");
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
