// Gera as imagens do README (docs/imagens/*.png) a partir do projeto de exemplo
// em docs/imagens/exemplo. Uso: pnpm prints (constrói o CLI antes).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs", "imagens");
const exemplo = join(out, "exemplo", "loja");
const PORT = "4390";
// Falso e óbvio, para o gitleaks não tomar por segredo.
const TOKEN = "prints-readme-token-not-a-secret-0000";
const data = mkdtempSync(join(tmpdir(), "8n8-prints-"));
const SETTLE_MS = 4000; // os nós entram animados

const server = spawn(
  process.execPath,
  [join(root, "apps", "cli", "dist", "8n8.mjs"), "--no-open"],
  {
    env: {
      ...process.env,
      APP8N8_TOKEN: TOKEN,
      APP8N8_PORT: PORT,
      OPENROUTER_API_KEY: "",
      APP8N8_CACHE_DIR: join(data, "cache"),
      APP8N8_CONFIG_DIR: join(data, "config"),
      APP8N8_HISTORY_DIR: join(data, "history"),
    },
    stdio: "ignore",
  },
);

async function waitServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.status < 500) return;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("o servidor não subiu");
}

/** Clica no card de um nó pelo título e espera o nível novo assentar. */
async function abrir(page, titulo) {
  await page
    .locator(`[aria-roledescription="node"]:has-text("${titulo}")`)
    .first()
    .dispatchEvent("click");
  await page.waitForTimeout(SETTLE_MS);
}

async function novaPagina(browser, tema) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: tema,
    extraHTTPHeaders: { "x-8n8-token": TOKEN },
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/#t=${TOKEN}`);
  await page.waitForTimeout(800);
  return { ctx, page };
}

const shot = (page, nome, tema) =>
  page.screenshot({ path: join(out, `${nome}-${tema}.png`) });

/** A tela inicial vem antes de abrir qualquer pasta: o histórico (Recentes) tem de estar vazio. */
async function inicio(browser, tema) {
  const { ctx, page } = await novaPagina(browser, tema);
  await shot(page, "inicio", tema);
  await ctx.close();
}

async function mapa(browser, tema) {
  const { ctx, page } = await novaPagina(browser, tema);
  await page.getByLabel("Caminho da pasta").fill(exemplo);
  await page.getByRole("button", { name: "Mapear pasta" }).click();
  await page.waitForTimeout(SETTLE_MS);
  await shot(page, "pasta", tema);

  await abrir(page, "pedidos.py");
  await abrir(page, "Processar pedido");
  await shot(page, "fluxo", tema);
  await ctx.close();
}

try {
  await waitServer();
  const browser = await chromium.launch();
  const temas = ["dark", "light"];
  for (const tema of temas) await inicio(browser, tema);
  for (const tema of temas) await mapa(browser, tema);
  await browser.close();
} finally {
  server.kill();
  // No Windows o servidor ainda segura a pasta por um instante.
  try {
    rmSync(data, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 300,
    });
  } catch {
    // a pasta é temporária; o sistema a limpa depois
  }
}
