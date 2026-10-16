import { OFFLINE } from "./mapa";
import { expect, test } from "./test";

// The app installs as a window of its own (manifest) and answers at 8n8.localhost,
// the name the CLI shows. The server is the built CLI on the default port (8148).

test("the page links a manifest that makes the app installable", async ({
  page,
}) => {
  await page.goto("/");
  const link = page.locator('link[rel="manifest"]');
  const href = await link.evaluate((el) => (el as HTMLLinkElement).href);
  expect(href).toBe(`${OFFLINE}/manifest.webmanifest`);

  const res = await page.request.get(href);
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest).toMatchObject({
    name: "8n8",
    start_url: "/",
    display: "standalone",
  });
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
});

test("every icon of the manifest is a PNG of the size it declares", async ({
  page,
}) => {
  const manifest = await (
    await page.request.get(`${OFFLINE}/manifest.webmanifest`)
  ).json();
  for (const icon of manifest.icons as { src: string; sizes: string }[]) {
    const res = await page.request.get(`${OFFLINE}${icon.src}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    const png = await res.body();
    // IHDR: width and height are two big-endian uint32 after the 8-byte signature.
    const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    expect(`${w}x${h}`).toBe(icon.sizes);
  }
});

test("8n8.localhost reaches the same app and the Host guard still refuses other names", async ({
  page,
}) => {
  await page.goto(`http://8n8.localhost:${process.env.E2E_PORT ?? 8148}/`);
  await expect(page).toHaveTitle("8n8");
  // Node does not resolve *.localhost as a browser does: the Host header carries the name.
  const evil = await page.request.get(`${OFFLINE}/`, {
    headers: { host: `evil.localhost:${process.env.E2E_PORT ?? 8148}` },
  });
  expect(evil.status()).toBe(403);
});
