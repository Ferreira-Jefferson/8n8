import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectSkeleton } from "@8n8/model";
import { OFFLINE } from "./mapa";
import { expect, type Page, test } from "./test";

// HTTP wires of TypeScript: a route takes the prefix of the router mount (`app.use("/api", users)`),
// a client with `baseURL` and a function that wraps `fetch` give requests, and a client call
// (`api.post("/x", data)`) is never a route.

let tmp = "";
let PASTA = "";

function makePasta(root: string): void {
  mkdirSync(join(root, "routes"), { recursive: true });
  const write = (path: string, lines: string[]) =>
    writeFileSync(join(root, path), [...lines, ""].join("\n"));
  write("server.ts", [
    'import express from "express";',
    'import { users } from "./routes/users";',
    "",
    "const app = express();",
    'app.use("/api", users);',
  ]);
  write("routes/users.ts", [
    'import { Router } from "express";',
    "",
    "export const users = Router();",
    'users.get("/users", (req, res) => res.json([]));',
    'users.post("/users", (req, res) => res.json({}));',
  ]);
  // A client with a base: GET /api/users.
  write("web.ts", [
    'import axios from "axios";',
    "",
    'const api = axios.create({ baseURL: "/api" });',
    "export function listar() {",
    '  return api.get("/users");',
    "}",
  ]);
  // A function that wraps fetch: POST /api/users at the call.
  write("envio.ts", [
    "function post(url: string, body: unknown) {",
    '  return fetch(url, { method: "POST", body: JSON.stringify(body) });',
    "}",
    "export function criar() {",
    '  return post("/api/users", { nome: "a" });',
    "}",
  ]);
  // The path without the prefix: no route answers it.
  write("antigo.ts", [
    "export function velho() {",
    '  return fetch("/users");',
    "}",
  ]);
  // Two clients of the same backend: no wire between them.
  write("cliente-a.ts", [
    'import axios from "axios";',
    "",
    'const api = axios.create({ baseURL: "https://backend.example.com" });',
    "export function salvar(u: { nome: string }) {",
    '  return api.post("/contatos", u);',
    "}",
  ]);
  write("cliente-b.ts", [
    "export function enviar() {",
    '  return fetch("/contatos", { method: "POST" });',
    "}",
  ]);
}

test.beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "8n8-rotas-http-"));
  PASTA = join(tmp, "rotas");
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

test.describe("Rotas HTTP do TypeScript", () => {
  test("a route takes the prefix of its mount, clients and wrappers call it, and a client call is no route", async ({
    page,
  }) => {
    const body = (await (
      await page.request.post(`${OFFLINE}/api/project`, {
        data: { path: PASTA },
      })
    ).json()) as ProjectSkeleton;
    const http = body.graph.edges.filter(
      (e) => e.kind === "calls" && e.label?.startsWith("HTTP"),
    );
    const wire = (from: string, to: string) =>
      http.find(
        (e) => e.source === `file:${from}` && e.target === `file:${to}`,
      );

    expect(wire("web.ts", "routes/users.ts")?.label).toBe(
      "HTTP GET /api/users",
    );
    expect(wire("envio.ts", "routes/users.ts")?.label).toBe(
      "HTTP POST /api/users",
    );
    expect(http.filter((e) => e.source === "file:antigo.ts")).toEqual([]);
    expect(http.filter((e) => e.target === "file:cliente-a.ts")).toEqual([]);
    expect(http.filter((e) => e.source === "file:cliente-b.ts")).toEqual([]);
  });

  test("the screen draws the wire to the folder of the mounted router and none between the two clients", async ({
    page,
  }) => {
    await openFolder(page);
    // At the top, the closed folder `routes` stands for its files.
    await expect(
      page.getByRole("group", {
        name: "Aresta de file:web.ts para dir:routes",
      }),
    ).toBeAttached();
    await expect(
      page.getByRole("group", {
        name: "Aresta de file:cliente-b.ts para file:cliente-a.ts",
      }),
    ).toHaveCount(0);
  });
});
