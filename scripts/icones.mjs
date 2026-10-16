// Gera os ícones do app (favicon, ICO e PNGs do PWA) a partir do logotipo do
// manual de marca (docs/marca/manual.html, símbolo #wordmark: 124 × 80 u).
//
// Até 48 px o desenho é refeito em pixels inteiros: cada linha cai no grid e
// não vira meio-tom. Acima disso, o logotipo escala sem ajuste. Fundo transparente.
//
//   node scripts/icones.mjs            grava em apps/ui/public
//   node scripts/icones.mjs <pasta>    grava as prévias em outra pasta

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const OUT = process.argv[2] ?? "apps/ui/public";

// Sem tema (barra de tarefas, dock): Petróleo e Pedra a 50%, legíveis em fundo claro e escuro.
const RASTER = { mk: "#3dbfa8", faint: "#979d9b", faintOpacity: 0.5 };

// Medidas do logotipo em pixels para um ícone de n × n.
function layout(n) {
  const hinted = n <= 48;
  const margin = n <= 32 ? 0 : n <= 48 ? 1 : n * 0.04;
  const w = n - 2 * margin;
  const s = w / 124;
  const r = (v) => (hinted ? Math.round(v) : v);
  const bw = r(44 * s); // largura externa do bloco (borda incluída)
  const bh = r(40 * s); // altura externa do bloco
  const t = hinted ? Math.max(1, Math.round(6 * s * 1.25)) : 6 * s; // borda do bloco
  const x0 = r(margin);
  const gap = w - 2 * bw;
  const y0 = r((n - 2 * bh) / 2);
  return {
    t,
    edge: hinted ? t : 5 * s,
    port: hinted ? Math.max(1, Math.round(t * 0.85)) : 5 * s,
    radius: Math.max(0, 9 * s - t / 2), // raio externo de 9 u, medido no meio da borda
    cols: [x0, x0 + bw + gap],
    rows: [y0, y0 + bh],
    bw,
    bh,
    gap,
    portY: hinted ? Math.max(t, Math.round(bh * 0.2)) : bh * 0.2,
  };
}

const f = (v) => +v.toFixed(3);

// Os quatro blocos, a aresta e as portas. `cls` dá a classe (favicon) ou a cor (raster).
function logo(n, paint) {
  const L = layout(n);
  const block = (x, y, kind) => {
    const h = L.t / 2;
    return `<rect ${paint[kind]} x="${f(x + h)}" y="${f(y + h)}" width="${f(L.bw - L.t)}" height="${f(L.bh - L.t)}" rx="${f(L.radius)}" stroke-width="${f(L.t)}"/>`;
  };
  const [c0, c1] = L.cols;
  const [r0, r1] = L.rows;
  const ax = c0 + L.bw;
  const ay = r0 + L.portY;
  const bx = c1;
  const by = r1 + L.bh - L.portY;
  // Mesma curva do manual: M44 8 C66 8 58 72 80 72, no vão de 36 u entre as colunas.
  const k1 = ax + (L.gap * 22) / 36;
  const k2 = ax + (L.gap * 14) / 36;
  return [
    block(c0, r1, "faint"),
    block(c1, r0, "faint"),
    block(c0, r0, "mk"),
    block(c1, r1, "mk"),
    `<path ${paint.mk} d="M${f(ax)} ${f(ay)}C${f(k1)} ${f(ay)} ${f(k2)} ${f(by)} ${f(bx)} ${f(by)}" stroke-width="${f(L.edge)}" stroke-linecap="round"/>`,
    `<circle ${paint.mkf} cx="${f(ax)}" cy="${f(ay)}" r="${f(L.port)}"/>`,
    `<circle ${paint.mkf} cx="${f(bx)}" cy="${f(by)}" r="${f(L.port)}"/>`,
  ].join("\n    ");
}

function rasterSvg(n) {
  const paint = {
    mk: `stroke="${RASTER.mk}"`,
    faint: `stroke="${RASTER.faint}" stroke-opacity="${RASTER.faintOpacity}"`,
    mkf: `fill="${RASTER.mk}"`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 ${n} ${n}" fill="none">
    ${logo(n, paint)}
</svg>`;
}

// O favicon desenha no grid de 16: em 32 e 48 px cada medida dobra ou triplica, ainda inteira.
function faviconSvg() {
  const paint = {
    mk: 'class="mk"',
    faint: 'class="faint" stroke-opacity="0.2"',
    mkf: 'class="mkf"',
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none">
  <title>8n8</title>
  <style>
    .mk { stroke: #3dbfa8; }
    .mkf { fill: #3dbfa8; }
    .faint { stroke: #e9ebea; }
    @media (prefers-color-scheme: light) {
      .mk { stroke: #0f7a6b; }
      .mkf { fill: #0f7a6b; }
      .faint { stroke: #12292a; }
    }
  </style>
    ${logo(16, paint)}
</svg>
`;
}

// ICO com PNGs dentro (aceito pelo Windows desde o Vista).
function ico(frames) {
  const head = Buffer.alloc(6 + 16 * frames.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(frames.length, 4);
  let offset = head.length;
  frames.forEach(({ n, png }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(n >= 256 ? 0 : n, e);
    head.writeUInt8(n >= 256 ? 0 : n, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...frames.map((fr) => fr.png)]);
}

const SIZES = [16, 24, 32, 48, 64, 96, 128, 180, 192, 256, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 256];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const pngs = new Map();
for (const n of SIZES) {
  await page.setViewportSize({ width: n, height: n });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${rasterSvg(n)}</body></html>`,
  );
  pngs.set(n, await page.locator("svg").screenshot({ omitBackground: true }));
}
await browser.close();

for (const n of SIZES) {
  const name = n === 180 ? "apple-touch-icon.png" : `icon-${n}.png`;
  writeFileSync(join(OUT, name), pngs.get(n));
}
writeFileSync(
  join(OUT, "favicon.ico"),
  ico(ICO_SIZES.map((n) => ({ n, png: pngs.get(n) }))),
);
writeFileSync(join(OUT, "favicon.svg"), faviconSvg());
console.log(`ícones gravados em ${OUT}`);
