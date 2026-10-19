import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProjectSkeleton } from "@8n8/model";
import { clickCard, edges, nodeById, OFFLINE } from "./mapa";
import { expect, type Page, test } from "./test";

// TypeScript structure, end to end: a workspace package imported by name is a project file
// (G4), and a syntax error keeps the functions after it (G15). Real server, real disk.

let tmp = "";
let MONO = "";
let BROKEN = "";

function write(root: string, files: Record<string, string>): void {
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
}

test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "8n8-monorepo-"));
  MONO = join(tmp, "mono");
  write(MONO, {
    "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
    "packages/core/package.json":
      '{ "name": "@acme/core", "main": "src/index.ts" }\n',
    "packages/core/src/index.ts":
      "export function coreFn() {\n  return 1;\n}\n",
    "packages/app/package.json":
      '{ "name": "@acme/app", "dependencies": { "@acme/core": "workspace:*" } }\n',
    "packages/app/src/main.ts":
      'import { coreFn } from "@acme/core";\n\nexport function main() {\n  return coreFn();\n}\n',
  });
  BROKEN = join(tmp, "quebrado");
  write(BROKEN, {
    "broken.ts":
      "export function ok() {\n  return 1;\n}\nexport function bad( {\n  return 2\n}\nexport function after() {\n  return ok();\n}\n",
  });
});

test.afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const project = async (page: Page, path: string) =>
  (await (
    await page.request.post(`${OFFLINE}/api/project`, { data: { path } })
  ).json()) as ProjectSkeleton;

async function openFolder(page: Page, path: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Caminho da pasta").fill(path);
  await page.getByRole("button", { name: "Mapear pasta" }).click();
}

test.describe("TypeScript: monorepo and syntax errors", () => {
  test("an import of a workspace package wires the two packages, and no package.json is a file of the map", async ({
    page,
  }) => {
    const body = await project(page, MONO);

    const app = "file:packages/app/src/main.ts";
    const core = "file:packages/core/src/index.ts";
    expect(
      body.graph.edges
        .filter((e) => e.source === app && e.target === core)
        .map((e) => e.kind)
        .sort(),
    ).toEqual(["calls", "imports"]);
    expect(
      body.graph.nodes.filter((n) => n.kind === "file").map((n) => n.path),
    ).toEqual(["packages/app/src/main.ts", "packages/core/src/index.ts"]);
  });

  test("the screen draws the wire between the two package folders", async ({
    page,
  }) => {
    await openFolder(page, MONO);
    await clickCard(page, "dir:packages");

    await expect(nodeById(page, "dir:packages/app")).toBeVisible();
    await expect(nodeById(page, "dir:packages/core")).toBeVisible();
    await expect(edges(page)).toHaveCount(1);
    await expect(
      page.getByRole("group", {
        name: "Aresta de dir:packages/app para dir:packages/core",
      }),
    ).toHaveCount(1);
  });

  test("a syntax error keeps the functions after it, and the file card names the line", async ({
    page,
  }) => {
    const body = await project(page, BROKEN);
    expect(
      body.graph.nodes.find((n) => n.id === "file:broken.ts")?.syntaxError,
    ).toEqual({ line: 4 });

    await openFolder(page, BROKEN);
    await expect(
      nodeById(page, "file:broken.ts").getByText("Erro de sintaxe na linha 4"),
    ).toBeVisible();
    await clickCard(page, "file:broken.ts");
    await expect(nodeById(page, "file:broken.ts/fn:ok")).toBeVisible();
    await expect(nodeById(page, "file:broken.ts/fn:after")).toBeVisible();
  });
});
