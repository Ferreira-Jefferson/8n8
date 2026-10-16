import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../package.json"),
    "utf8",
  ),
) as Record<string, unknown> & {
  scripts: Record<string, string>;
  contributes: {
    commands: { command: string; title: string }[];
    menus: Record<string, { command: string; when?: string }[]>;
  };
};

describe("the extension manifest (VSC-01, VSC-02, VSC-07)", () => {
  it("ships one bundle and no dependency nor install script", () => {
    expect(manifest.main).toBe("./dist/extension.cjs");
    expect(manifest.files).toEqual(["dist"]);
    expect(manifest.dependencies).toBeUndefined();
    for (const hook of [
      "preinstall",
      "install",
      "postinstall",
      "prepare",
      "vscode:prepublish",
    ]) {
      expect(manifest.scripts[hook]).toBeUndefined();
    }
  });

  it("asks VS Code 1.138 or newer", () => {
    expect(manifest.engines).toEqual({ vscode: "^1.138.0" });
  });

  it("puts the 8n8 logo button in the editor title, with no side bar view", () => {
    const c = manifest.contributes as unknown as {
      commands: { command: string; icon?: { light: string; dark: string } }[];
      menus: Record<string, { command: string }[]>;
      views?: unknown;
      viewsContainers?: unknown;
    };
    expect(c.viewsContainers).toBeUndefined();
    expect(c.views).toBeUndefined();
    expect(c.commands[0]?.icon).toEqual({
      light: "dist/8n8-light.svg",
      dark: "dist/8n8-dark.svg",
    });
    expect(c.menus["editor/title"]).toEqual([
      expect.objectContaining({ command: "8n8.abrirMapa" }),
    ]);
  });

  it("offers Abrir mapa in the palette and the folder command in the Explorer only", () => {
    expect(
      manifest.contributes.commands.map((c) => [c.command, c.title]),
    ).toEqual([
      ["8n8.abrirMapa", "Abrir mapa"],
      ["8n8.abrirMapaDaPasta", "8n8: Abrir mapa desta pasta"],
    ]);
    expect(manifest.contributes.menus["explorer/context"]).toEqual([
      expect.objectContaining({
        command: "8n8.abrirMapaDaPasta",
        when: "explorerResourceIsFolder",
      }),
    ]);
    expect(manifest.contributes.menus.commandPalette).toEqual([
      { command: "8n8.abrirMapaDaPasta", when: "false" },
    ]);
  });
});
