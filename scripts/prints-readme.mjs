// Gera as imagens do README (docs/images/*.png) a partir do projeto de exemplo
// em docs/sample-project. Uso: pnpm prints (constrói o CLI antes).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs", "images");
const exemplo = join(root, "docs", "sample-project", "store");
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
      // Sem LLM: os cartões mostram os nomes provisórios, iguais em toda rodada.
      APP8N8_LLM_PROVIDER: "openrouter",
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

const shot = (page, nome, tema, pasta = out) =>
  page.screenshot({ path: join(pasta, `${nome}-${tema}.png`) });

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

  await abrir(page, "orders.py");
  await abrir(page, "Process order");
  await shot(page, "fluxo", tema);
  await ctx.close();
}

/** Um trecho colado, com o nó aberto: a tela do guia visual, com a caixa de cada peça (em % da imagem). */
const TRECHO = [
  "def process_order(items):",
  "    for item in items:",
  "        calculate_shipping(item)",
  '    print("ok")',
  "    return 1",
  "",
].join("\n");

async function telaDoGuia(browser, tema) {
  const { ctx, page } = await novaPagina(browser, tema);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByRole("button", { name: /Colar trecho/ }).click();
  await page.getByLabel("Trecho de código").fill(TRECHO);
  await page.getByRole("button", { name: "Gerar mapa" }).click();
  await page.waitForTimeout(SETTLE_MS);
  await abrir(page, "Process order");
  // O último item da trilha abre o painel do nó aberto.
  await page.locator("nav.breadcrumb").getByText("Process order").click();
  await page.getByRole("button", { name: "Expandir painel" }).click();
  await page.waitForTimeout(1500);
  await shot(page, "tela", tema, join(root, "docs", "design"));
  if (tema === "dark") {
    const alvos = {
      1: ".logo-link",
      2: "nav.breadcrumb",
      3: ".new-code",
      4: ".search-lupa",
      5: ".settings-btn",
      6: ".history-btn",
      7: ".react-flow",
      8: ".hub",
      9: '[aria-roledescription="node"]:not(.hub):not(:has(.hub))',
      10: ".react-flow__edge path.wire >> nth=1",
      11: ".detail-panel",
    };
    const caixas = {};
    for (const [n, css] of Object.entries(alvos)) {
      const alvo = page.locator(css).first();
      const box = (await alvo.count()) ? await alvo.boundingBox() : null;
      if (box) {
        caixas[n] = [box.x, box.y, box.width, box.height].map((v) =>
          Math.round(v),
        );
      }
    }
    console.log("CAIXAS", JSON.stringify(caixas));
  }
  await ctx.close();
}

/** A etiqueta de uma aresta de dependência, depois da pausa do mouse sobre a linha. */
async function etiquetaDoGuia(browser, tema) {
  const { ctx, page } = await novaPagina(browser, tema);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByLabel("Caminho da pasta").fill(exemplo);
  await page.getByRole("button", { name: "Mapear pasta" }).click();
  await page.waitForTimeout(SETTLE_MS);
  await abrir(page, "store");
  const hit = page
    .getByRole("group", { name: /orders\.py para .*server\.ts/ })
    .locator("path.wire-hit");
  const ponto = await hit.evaluate((el) => {
    const len = el.getTotalLength();
    const p = el.getPointAtLength(len / 2);
    const m = el.getScreenCTM();
    return { x: m.a * p.x + m.e, y: m.d * p.y + m.f };
  });
  await page.mouse.move(ponto.x, ponto.y);
  await page.waitForTimeout(600);
  await shot(page, "etiqueta", tema, join(root, "docs", "design"));
  await ctx.close();
}

try {
  await waitServer();
  const browser = await chromium.launch();
  const temas = ["dark", "light"];
  for (const tema of temas) await inicio(browser, tema);
  for (const tema of temas) await mapa(browser, tema);
  for (const tema of temas) await telaDoGuia(browser, tema);
  for (const tema of temas) await etiquetaDoGuia(browser, tema);
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
