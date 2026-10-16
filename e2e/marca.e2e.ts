import {
  canvas,
  css,
  GROUND,
  generate,
  MAIN,
  nodes,
  OFFLINE,
  VIDEO,
} from "./mapa";
import { expect, test } from "./test";

// The 8n8 brand in the app (docs/design/manual-marca.html): name, logo, favicon and
// the two themes, which follow the system's color scheme.

const PAPEL = "rgb(242, 243, 240)";
const TINTA = "rgb(18, 41, 42)";
const PETROLEO_ESCURO = "rgb(15, 122, 107)";
const BRANCO = "rgb(255, 255, 255)";

test("the tab says 8n8 and shows the full logo as its icon", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("8n8");
  const icon = page.locator('link[rel="icon"][type="image/svg+xml"]');
  // Relative since feature 10 (VSC-04): it resolves to the root's favicon.
  expect(await icon.evaluate((el) => (el as HTMLLinkElement).href)).toBe(
    `${OFFLINE}/favicon.svg?v=5`,
  );
  const res = await page.request.get(`${OFFLINE}/favicon.svg`);
  expect(res.status()).toBe(200);
  const svg = await res.text();
  expect(svg).toContain("<title>8n8</title>");
  // The icon is the manual's full logo with no tile: four blocks (two at 20%), two ports, the edge.
  expect(svg.match(/<rect class="(mk|faint)"/g)).toHaveLength(4);
  expect(svg.match(/class="faint"[^>]*stroke-opacity="0.2"/g)).toHaveLength(2);
  expect(svg.match(/<circle class="mkf"/g)).toHaveLength(2);
  expect(svg.match(/<path class="mk"/g)).toHaveLength(1);
  expect(svg).not.toMatch(/<rect class="tile"/);
  // Drawn on a 16 grid: every block edge lands on a whole pixel at 16, 32 and 48 px.
  for (const m of svg.matchAll(
    /<rect [^>]*x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*stroke-width="([\d.]+)"/g,
  )) {
    const [x, y, w, h, t] = m.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
      number,
    ];
    for (const edge of [x - t / 2, y - t / 2, x + w + t / 2, y + h + t / 2])
      expect(Number.isInteger(edge)).toBe(true);
  }
  // The raster icons are crisp at their own size: the ICO holds 16, 24, 32, 48, 64 and 256 px.
  const ico = await page.request.get(`${OFFLINE}/favicon.ico`);
  expect(ico.status()).toBe(200);
  const body = await ico.body();
  const count = body.readUInt16LE(4);
  const sizes = Array.from(
    { length: count },
    (_, i) => body[6 + 16 * i] || 256,
  );
  expect(sizes).toEqual([16, 24, 32, 48, 64, 256]);
});

test("the launcher shows the full logo: linked blocks in Petróleo, the others faded", async ({
  page,
}) => {
  await page.goto("/");
  const logo = page.getByRole("img", { name: "8n8" });
  await expect(logo).toBeVisible();
  await expect(logo.locator("rect")).toHaveCount(4);
  await expect(logo.locator('rect[stroke-opacity="0.2"]')).toHaveCount(2);
  const linked = logo.locator('rect[stroke="var(--main)"]').first();
  expect(await css(linked, "stroke")).toBe(MAIN);
});

test.describe("dark theme", () => {
  test("Grafite ground and Petróleo action, on the launcher and the map", async ({
    page,
  }) => {
    await page.goto("/");
    expect(await css(page.locator("body"), "background-color")).toBe(GROUND);
    const map = page.getByRole("button", { name: "Buscar no PC" });
    expect(await css(map, "background-color")).toBe(MAIN);

    await generate(page, OFFLINE, VIDEO);
    await expect(nodes(page).first()).toBeVisible();
    expect(await css(canvas(page), "background-color")).toBe(GROUND);
  });
});

test.describe("light theme", () => {
  test.use({ colorScheme: "light" });

  test("Papel ground, Tinta text and Petróleo escuro action on the launcher", async ({
    page,
  }) => {
    await page.goto("/");
    const body = page.locator("body");
    expect(await css(body, "background-color")).toBe(PAPEL);
    expect(await css(body, "color")).toBe(TINTA);
    const map = page.getByRole("button", { name: "Buscar no PC" });
    expect(await css(map, "background-color")).toBe(PETROLEO_ESCURO);
    expect(await css(map, "color")).toBe(PAPEL);
  });

  test("the map: Papel canvas, white cards, Petróleo escuro ports and edges", async ({
    page,
  }) => {
    await generate(page, OFFLINE, VIDEO);
    const card = nodes(page).first().locator(".node");
    await expect(card).toBeVisible();
    expect(await css(canvas(page), "background-color")).toBe(PAPEL);
    expect(await css(card, "background-color")).toBe(BRANCO);
    const port = page.locator(".react-flow__handle.port").first();
    expect(await css(port, "background-color")).toBe(PETROLEO_ESCURO);
    const edge = page.locator("path.wire").first();
    await expect(edge).toBeAttached();
    expect(await css(edge, "stroke")).toBe(PETROLEO_ESCURO);
  });
});
