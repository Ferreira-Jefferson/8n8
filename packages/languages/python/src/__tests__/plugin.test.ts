import { readFileSync } from "node:fs";
import { describeLanguagePlugin } from "@8n8/lang-testkit";
import { describe, expect, it } from "vitest";
import { pythonPlugin } from "../index";
import { lojaFiles } from "./loja";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describeLanguagePlugin(pythonPlugin, {
  snippets: [
    fixture("pedido_frete.py"),
    fixture("pedido_video.py"),
    fixture("errors/parentese_aberto.py"),
    fixture("errors/indentacao.py"),
    "x = 1\n",
    "",
  ],
  files: [
    ...lojaFiles(),
    { path: "erro.py", source: "def g():\n    x = (1 +\n" },
    { path: "api/rotas.py", source: fixture("rotas.py") },
  ],
});

describe("pythonPlugin", () => {
  it("declares what the core needs to read and show a Python folder", () => {
    expect(pythonPlugin).toMatchObject({
      id: "python",
      label: "Python",
      extensions: [".py"],
      ignoredDirs: [".venv", "venv", "__pycache__", "site-packages"],
      commentPrefix: "#",
    });
  });

  it("extracts a snippet with the language python and no file prefix", () => {
    const graph = pythonPlugin.extract(fixture("pedido_frete.py"));

    expect(graph.language).toBe("python");
    expect(graph.nodes[0]?.id).toBe("fn:calcular_frete");
  });

  it("marks a syntax error in a snippet", () => {
    const graph = pythonPlugin.extract("def f():\n    x = (1 +\n");

    expect(graph.nodes.some((n) => n.syntaxError?.line === 2)).toBe(true);
  });
});
