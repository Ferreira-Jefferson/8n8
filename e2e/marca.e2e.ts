import { expect, test } from "@playwright/test";
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

// The 8n8 brand in the app (docs/marca/manual.html): name, logo, favicon and
// the two themes, which follow the system's color scheme.

const PAPEL = "rgb(242, 243, 240)";
const TINTA = "rgb(18, 41, 42)";
const PETROLEO_ESCURO = "rgb(15, 122, 107)";
const BRANCO = "rgb(255, 255, 255)";

test("the tab says 8n8 and shows the symbol as its icon", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("8n8");
  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveAttribute("href", "/favicon.svg");
  const res = await page.request.get(`${OFFLINE}/favicon.svg`);
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain("<title>8n8</title>");
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
    const map = page.getByRole("button", { name: "Mapear pasta" });
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
    const map = page.getByRole("button", { name: "Mapear pasta" });
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
