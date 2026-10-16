import { expect, test } from "./test";

// Empty field + click: the system chooser (faked here, a native dialog cannot be driven)
// returns a path and the app maps it at once. A single file maps as a one-file project.

test("campo vazio: um único botão abre o seletor de arquivo ou pasta e mapeia o que a pessoa escolheu", async ({
  page,
}) => {
  let asked = "";
  await page.route("**/api/pick", async (route) => {
    asked = route.request().postDataJSON().kind;
    await route.fulfill({ json: { path: "C:\naoexiste.py" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Buscar no PC" }).click();
  await expect.poll(() => asked).toBe("any");
  // The path does not exist, so the app answers as for any missing path.
  await expect(page.getByRole("alert").first()).toBeVisible();
});

test("cancelar o seletor não muda a tela", async ({ page }) => {
  await page.route("**/api/pick", (route) =>
    route.fulfill({ json: { path: null } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Buscar no PC" }).click();
  await expect(page.getByLabel("Caminho da pasta")).toHaveValue("");
});
