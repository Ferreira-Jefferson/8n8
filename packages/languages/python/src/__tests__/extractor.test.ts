import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPythonExtractor } from "../index";
import { lojaFiles } from "./loja";

const videoFixture = readFileSync(
  new URL("./fixtures/pedido_frete.py", import.meta.url),
  "utf8",
);

describe("createPythonExtractor", () => {
  it("declares the python language", async () => {
    const extractor = await createPythonExtractor();

    expect(extractor.language).toBe("python");
  });

  it("gives the same graph from two new extractors, matching the snapshot (CORE-04)", async () => {
    const first = (await createPythonExtractor()).extract(videoFixture);
    const second = (await createPythonExtractor()).extract(videoFixture);

    expect(second).toEqual(first);
    expect(JSON.stringify(first, null, 2)).toMatchSnapshot();
  });

  it("gives the same graph when one extractor runs twice", async () => {
    const extractor = await createPythonExtractor();

    expect(extractor.extract(videoFixture)).toEqual(
      extractor.extract(videoFixture),
    );
  });

  it("extracts the projeto-loja fixture as a project: 11 folder and file nodes, 4 imports wires", async () => {
    const graph = (await createPythonExtractor()).extractProject(lojaFiles());

    expect(
      graph.nodes
        .filter((n) => n.kind === "folder" || n.kind === "file")
        .map((n) => n.id),
    ).toEqual([
      "dir:frete",
      "file:frete/__init__.py",
      "file:frete/calculo.py",
      "dir:legado",
      "file:legado/frete_antigo.py",
      "dir:pedidos",
      "file:pedidos/__init__.py",
      "file:pedidos/itens.py",
      "file:pedidos/pedidos.py",
      "file:main.py",
      "file:relatorio.py",
    ]);
    expect(
      graph.edges
        .filter((e) => e.kind === "imports")
        .map((e) => [e.source, e.target])
        .sort(),
    ).toEqual(
      [
        ["file:main.py", "file:pedidos/pedidos.py"],
        ["file:pedidos/pedidos.py", "file:frete/__init__.py"],
        ["file:pedidos/pedidos.py", "file:pedidos/itens.py"],
        ["file:frete/__init__.py", "file:frete/calculo.py"],
      ].sort(),
    );
  });

  it("maps the video fixture: two functions, one wire, HTTP → Código → peso > 30 with two branches", async () => {
    const graph = (await createPythonExtractor()).extract(videoFixture);

    const tops = graph.nodes.filter((n) => n.parentId === null);
    expect(tops.map((n) => [n.kind, n.label])).toEqual([
      ["function", "calcular_frete"],
      ["function", "processar_pedido"],
    ]);
    const topIds = new Set(tops.map((n) => n.id));
    expect(
      graph.edges
        .filter((e) => topIds.has(e.source) && topIds.has(e.target))
        .map((e) => [e.kind, e.source, e.target]),
    ).toEqual([["calls", "fn:processar_pedido", "fn:calcular_frete"]]);

    const steps = graph.nodes.filter(
      (n) => n.parentId === "fn:calcular_frete" && !n.id.includes("/b"),
    );
    expect(steps.map((n) => [n.kind, n.category ?? n.label])).toEqual([
      ["external", "HTTP"],
      ["code", "Código"],
      ["condition", "peso > 30"],
    ]);
    const condition = steps[2]?.id;
    expect(
      graph.edges
        .filter((e) => e.kind === "branch" && e.source === condition)
        .map((e) => e.label),
    ).toEqual(["sim", "não"]);

    const httpLine =
      videoFixture.split("\n").findIndex((l) => l.includes("requests.get")) + 1;
    expect(steps[0]?.range).toEqual({ start: httpLine, end: httpLine });
  });
});
