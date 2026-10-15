import { readFileSync } from "node:fs";
import { describeLanguagePlugin } from "@8n8/lang-testkit";
import { describe, expect, it } from "vitest";
import { typescriptPlugin } from "../index";
import { lojaFiles } from "./loja";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describeLanguagePlugin(typescriptPlugin, {
  snippets: [
    fixture("pedido-frete.ts"),
    "export function f(a: number) {\n  return (a +\n",
    "const x = 1;\n",
    "",
  ],
  files: [
    ...lojaFiles(),
    { path: "erro.ts", source: "export function g() {\n  const x = (1 +\n" },
  ],
});

describe("typescriptPlugin", () => {
  it("declares what the core needs to read and show a TypeScript folder", () => {
    expect(typescriptPlugin).toMatchObject({
      id: "typescript",
      label: "TypeScript",
      extensions: [".ts", ".tsx"],
      commentPrefix: "//",
    });
  });
});
