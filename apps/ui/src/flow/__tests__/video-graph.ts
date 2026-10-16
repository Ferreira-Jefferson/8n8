import type { FlowEdge, FlowNode, Graph } from "@8n8/model";

/**
 * Graph of languages/python fixtures/pedido_video.py, built by hand from the
 * table "Código do vídeo" of the 05-mapa-do-video design (tracks A and C).
 */
function step(
  id: string,
  kind: FlowNode["kind"],
  label: string,
  parentId: string,
  line: number,
  extra: Partial<FlowNode> = {},
): FlowNode {
  return {
    id,
    kind,
    label,
    parentId,
    range: { start: line, end: line },
    openable: false,
    ...extra,
  };
}

const P = "fn:processar_pedido";
const C = "fn:calcular_frete";

const nodes: FlowNode[] = [
  {
    id: P,
    kind: "function",
    label: "processar_pedido",
    parentId: null,
    range: { start: 6, end: 14 },
    openable: true,
  },
  step(`${P}/s0`, "external", "json.loads", P, 7, {
    callee: "json.loads",
    category: "EXTERNO",
  }),
  step(`${P}/s1`, "external", "validar_pedido", P, 8, {
    callee: "validar_pedido",
    category: "EXTERNO",
  }),
  step(`${P}/s2`, "external", "db.buscar_cliente", P, 9, {
    callee: "db.buscar_cliente",
    category: "BANCO",
  }),
  step(`${P}/s3`, "call", "calcular_frete", P, 10, {
    target: C,
    openable: true,
  }),
  step(`${P}/s4`, "external", "soma_itens", P, 11, {
    callee: "soma_itens",
    category: "EXTERNO",
  }),
  step(`${P}/s5`, "external", "db.salvar", P, 12, {
    callee: "db.salvar",
    category: "BANCO",
  }),
  step(`${P}/s6`, "external", "enviar_email", P, 13, {
    callee: "enviar_email",
    category: "EMAIL",
  }),
  step(`${P}/s7`, "return", '{"ok": True, "total": total}', P, 14),
  {
    id: C,
    kind: "function",
    label: "calcular_frete",
    parentId: null,
    range: { start: 17, end: 23 },
    openable: true,
  },
  step(`${C}/s0`, "external", "requests.get", C, 18, {
    callee: "requests.get",
    category: "HTTP",
  }),
  step(`${C}/s1`, "external", "sum", C, 19, {
    callee: "sum",
    category: "EXTERNO",
  }),
  {
    ...step(`${C}/s2`, "condition", "peso > 30", C, 20),
    range: { start: 20, end: 23 },
  },
  step(`${C}/s2/b0/s0`, "return", "TABELA_PESADA[uf]", C, 21),
  step(`${C}/s2/b1/s0`, "return", "TABELA_PADRAO[uf]", C, 23),
];

function next(source: string, target: string): FlowEdge {
  return { id: `next:${source}->${target}`, kind: "next", source, target };
}

const edges: FlowEdge[] = [
  ...[0, 1, 2, 3, 4, 5, 6].map((i) => next(`${P}/s${i}`, `${P}/s${i + 1}`)),
  next(`${C}/s0`, `${C}/s1`),
  next(`${C}/s1`, `${C}/s2`),
  {
    id: `branch:${C}/s2->${C}/s2/b0/s0`,
    kind: "branch",
    source: `${C}/s2`,
    target: `${C}/s2/b0/s0`,
    label: "true",
  },
  {
    id: `branch:${C}/s2->${C}/s2/b1/s0`,
    kind: "branch",
    source: `${C}/s2`,
    target: `${C}/s2/b1/s0`,
    label: "false",
  },
  { id: `calls:${P}->${C}`, kind: "calls", source: P, target: C },
];

export const videoGraph: Graph = {
  language: "python",
  empty: false,
  nodes,
  edges,
};
