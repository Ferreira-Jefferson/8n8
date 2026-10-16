import { readFileSync } from "node:fs";
import type { FlowNode, Graph } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { createPythonExtractor } from "../index";

const videoSnippet = readFileSync(
  new URL("./fixtures/pedido_video.py", import.meta.url),
  "utf8",
);

async function videoGraph(): Promise<Graph> {
  return (await createPythonExtractor()).extract(videoSnippet);
}

type Row = [
  id: string,
  kind: FlowNode["kind"],
  start: number,
  end: number,
  category?: string | undefined,
  callee?: string | undefined,
  target?: string | undefined,
];

/** The "Grafo esperado" table of the design, in pre-order. */
const EXPECTED: Row[] = [
  ["fn:processar_pedido", "function", 6, 14],
  ["fn:processar_pedido/s0", "external", 7, 7, "EXTERNO", "json.loads"],
  ["fn:processar_pedido/s1", "external", 8, 8, "EXTERNO", "validar_pedido"],
  ["fn:processar_pedido/s2", "external", 9, 9, "BANCO", "db.buscar_cliente"],
  [
    "fn:processar_pedido/s3",
    "call",
    10,
    10,
    undefined,
    undefined,
    "fn:calcular_frete",
  ],
  ["fn:processar_pedido/s4", "external", 11, 11, "EXTERNO", "soma_itens"],
  ["fn:processar_pedido/s5", "external", 12, 12, "BANCO", "db.salvar"],
  ["fn:processar_pedido/s6", "external", 13, 13, "EMAIL", "enviar_email"],
  ["fn:processar_pedido/s7", "return", 14, 14],
  ["fn:calcular_frete", "function", 17, 23],
  ["fn:calcular_frete/s0", "external", 18, 18, "HTTP", "requests.get"],
  ["fn:calcular_frete/s1", "external", 19, 19, "EXTERNO", "sum"],
  ["fn:calcular_frete/s2", "condition", 20, 23],
  ["fn:calcular_frete/s2/b0/s0", "return", 21, 21],
  ["fn:calcular_frete/s2/b1/s0", "return", 23, 23],
];

/** VID-24: function, class, module, loop, block and call with a target open. */
function opensByRule(node: FlowNode): boolean {
  if (node.kind === "call") return node.target !== undefined;
  return [
    "folder",
    "file",
    "module",
    "function",
    "class",
    "loop",
    "block",
  ].includes(node.kind);
}

describe("extractor: the video snippet (VID-10, VID-13, VID-20)", () => {
  it("gives the nodes of the expected graph, in pre-order", async () => {
    const graph = await videoGraph();

    expect(
      graph.nodes.map((n): Row => {
        const row: Row = [n.id, n.kind, n.range.start, n.range.end];
        if (n.category !== undefined || n.callee !== undefined) {
          row.push(n.category, n.callee);
        }
        if (n.target !== undefined) row.push(undefined, undefined, n.target);
        return row;
      }),
    ).toEqual(EXPECTED);
  });

  it("labels the return steps with the returned expression", async () => {
    const graph = await videoGraph();

    expect(
      graph.nodes.filter((n) => n.kind === "return").map((n) => n.label),
    ).toEqual([
      '{"ok": True, "total": total}',
      "TABELA_PESADA[uf]",
      "TABELA_PADRAO[uf]",
    ]);
  });

  it("marks every node openable by the VID-24 rule", async () => {
    const graph = await videoGraph();

    expect(graph.nodes.map((n) => [n.id, n.openable])).toEqual(
      graph.nodes.map((n) => [n.id, opensByRule(n)]),
    );
    expect(graph.nodes.filter((n) => n.openable).map((n) => n.id)).toEqual([
      "fn:processar_pedido",
      "fn:processar_pedido/s3",
      "fn:calcular_frete",
    ]);
  });

  it("gives exactly the expected wires", async () => {
    const graph = await videoGraph();
    const p = "fn:processar_pedido";
    const c = "fn:calcular_frete";
    const next = (from: string, to: string) => ({
      id: `next:${from}->${to}`,
      kind: "next",
      source: from,
      target: to,
    });
    const steps = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `${p}/s${i}`);

    expect(graph.edges).toEqual([
      ...steps.slice(1).map((to, i) => next(steps[i] ?? "", to)),
      next(`${c}/s0`, `${c}/s1`),
      next(`${c}/s1`, `${c}/s2`),
      {
        id: `branch:${c}/s2->${c}/s2/b0/s0`,
        kind: "branch",
        source: `${c}/s2`,
        target: `${c}/s2/b0/s0`,
        label: "true",
      },
      {
        id: `branch:${c}/s2->${c}/s2/b1/s0`,
        kind: "branch",
        source: `${c}/s2`,
        target: `${c}/s2/b1/s0`,
        label: "false",
      },
      { id: `calls:${p}->${c}`, kind: "calls", source: p, target: c },
    ]);
  });

  it("sends no wire out of a return step", async () => {
    const graph = await videoGraph();
    const returns = new Set(
      graph.nodes.filter((n) => n.kind === "return").map((n) => n.id),
    );

    expect(returns.size).toBe(3);
    expect(graph.edges.filter((e) => returns.has(e.source))).toEqual([]);
  });

  it("gives the same graph when extracted twice (CORE-04)", async () => {
    const extractor = await createPythonExtractor();

    expect(extractor.extract(videoSnippet)).toEqual(
      extractor.extract(videoSnippet),
    );
    expect(extractor.extract(videoSnippet)).toEqual(await videoGraph());
  });
});
