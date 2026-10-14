import type {
  Explanation,
  FlowNode,
  Graph,
  ProjectResponse,
} from "@code2n8n/model";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { fetchExplanation, fetchGraph, fetchProject } from "../api";
import { lojaGraph } from "../flow/__tests__/loja-graph";
import type { FlowCanvasProps } from "../flow/FlowCanvas";
import { projectLevel } from "../flow/project-level";
import { pedidoFreteGraph } from "../panel/__tests__/pedido-frete-graph";

vi.mock("../api", () => ({
  fetchGraph: vi.fn(),
  fetchExplanation: vi.fn(),
  fetchProject: vi.fn(),
}));

let canvas: FlowCanvasProps | null = null;
vi.mock("../flow/FlowCanvas", () => ({
  FlowCanvas: (props: FlowCanvasProps) => {
    canvas = props;
    return <div data-testid="canvas" />;
  },
}));

const graphMock = vi.mocked(fetchGraph);
const explainMock = vi.mocked(fetchExplanation);
const projectMock = vi.mocked(fetchProject);

beforeEach(() => {
  canvas = null;
  graphMock.mockReset();
  explainMock.mockReset();
  projectMock.mockReset();
});
afterEach(cleanup);

const source = "def calcular_frete(peso):\n    return peso\n";

const fnNode: FlowNode = {
  id: "fn:calcular_frete",
  kind: "function",
  label: "calcular_frete",
  parentId: null,
  range: { start: 1, end: 2 },
  openable: true,
};
const graph: Graph = {
  language: "python",
  empty: false,
  nodes: [fnNode],
  edges: [],
};

const explanation: Explanation = {
  summary: "Devolve o peso.",
  sentences: [{ id: "s1", text: "Devolve o peso.", lines: [2] }],
  inputs: [{ id: "i1", text: "peso", lines: [1] }],
  outputs: [{ id: "o1", text: "peso", lines: [2] }],
  suggestions: [
    {
      id: "g1",
      command: "Valide o peso",
      reason: "r1",
      line: 1,
      severity: "media",
      lines: [1],
    },
    {
      id: "g2",
      command: "Use tipos",
      reason: "r2",
      line: 2,
      severity: "baixa",
      lines: [2],
    },
  ],
};

async function generate(text = source) {
  render(<App />);
  fireEvent.change(screen.getByLabelText("Trecho Python"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Gerar mapa" }));
}

function currentCanvas(): FlowCanvasProps {
  if (!canvas) throw new Error("canvas not rendered");
  return canvas;
}

describe("App", () => {
  it("sends the pasted text to fetchGraph and passes the graph to the canvas (CORE-01)", async () => {
    graphMock.mockResolvedValue(graph);
    await generate();
    await screen.findByTestId("canvas");
    expect(graphMock).toHaveBeenCalledWith(source);
    expect(currentCanvas().graph).toEqual(graph);
    expect(currentCanvas().levelId).toBeNull();
  });

  it("shows the empty message for an empty graph (CORE-07)", async () => {
    graphMock.mockResolvedValue({ ...graph, empty: true, nodes: [] });
    await generate("# só comentário");
    expect(
      await screen.findByText("Nenhuma função ou instrução encontrada."),
    ).toBeTruthy();
    expect(screen.queryByTestId("canvas")).toBeNull();
  });

  it("shows a generic error in the map area when fetchGraph rejects", async () => {
    graphMock.mockRejectedValue(new Error("HTTP 400"));
    await generate();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Não foi possível gerar o mapa.",
    );
  });

  it("passes the suggestion count 2 to the canvas after the node is explained (CORE-23)", async () => {
    graphMock.mockResolvedValue(graph);
    explainMock.mockResolvedValue({
      status: "ok",
      explanation,
      fromCache: false,
      review: "full",
    });
    await generate();
    await screen.findByTestId("canvas");
    expect(currentCanvas().suggestionCounts.get("fn:calcular_frete")).toBe(
      undefined,
    );
    act(() => currentCanvas().onSelect("fn:calcular_frete"));
    await waitFor(() =>
      expect(currentCanvas().suggestionCounts.get("fn:calcular_frete")).toBe(2),
    );
    expect(explainMock).toHaveBeenCalledWith({ source }, "fn:calcular_frete");
  });

  it("keeps the graph on the canvas when the explanation fails (CORE-20)", async () => {
    graphMock.mockResolvedValue(graph);
    explainMock.mockResolvedValue({ status: "error", message: "HTTP 502" });
    await generate();
    await screen.findByTestId("canvas");
    act(() => currentCanvas().onSelect("fn:calcular_frete"));
    expect(await screen.findByText("Resumo indisponível")).toBeTruthy();
    expect(screen.getByTestId("canvas")).toBeTruthy();
    expect(currentCanvas().graph).toEqual(graph);
  });

  it("returns the canvas to the top level when Trecho is clicked after opening a node (CORE-15)", async () => {
    // VID-23: opening a node also shows its panel, which asks for a summary.
    explainMock.mockResolvedValue({ status: "no-key" });
    graphMock.mockResolvedValue(graph);
    await generate();
    await screen.findByTestId("canvas");
    act(() => currentCanvas().onOpen(fnNode));
    expect(currentCanvas().levelId).toBe("fn:calcular_frete");
    fireEvent.click(screen.getByRole("button", { name: "Trecho" }));
    expect(currentCanvas().levelId).toBeNull();
  });

  it("shows the graph-derived external effects of calcular_frete without a summary (FID-14)", async () => {
    graphMock.mockResolvedValue(pedidoFreteGraph);
    explainMock.mockResolvedValue({ status: "no-key" });
    await generate();
    await screen.findByTestId("canvas");
    act(() => currentCanvas().onSelect("fn:calcular_frete"));
    expect(
      await screen.findByText("Configure OPENROUTER_API_KEY para ver resumos"),
    ).toBeTruthy();
    const list = screen.getByRole("list", { name: "Efeitos externos" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["requests.get (HTTP, linha 5)"]);
  });
});

const lojaRoot = "C:\\tmp\\loja";
const calculoSource = [
  "def calcular_frete(peso):",
  "    if peso > 30:",
  "        return 50",
  "    return 20",
].join("\n");
const loja: ProjectResponse = {
  name: "loja",
  graph: lojaGraph,
  files: [{ path: "frete/calculo.py", source: calculoSource }],
  ignored: [],
};

function openFolder(path = lojaRoot) {
  fireEvent.change(screen.getByLabelText("Caminho da pasta"), {
    target: { value: path },
  });
  fireEvent.click(screen.getByRole("button", { name: "Abrir pasta" }));
}

function breadcrumbItems() {
  return within(
    screen.getByRole("navigation", { name: "Caminho de navegação" }),
  )
    .getAllByRole("button")
    .map((b) => b.textContent);
}

describe("App with a local folder (PROJ-02, PROJ-05, PROJ-06)", () => {
  it("maps the folder: 4 nodes at the top and the breadcrumb starts with loja", async () => {
    projectMock.mockResolvedValue(loja);
    render(<App />);
    openFolder();
    await screen.findByTestId("canvas");
    expect(projectMock).toHaveBeenCalledWith(lojaRoot);
    const { graph, levelId } = currentCanvas();
    expect(projectLevel(graph, levelId).nodes.map((n) => n.id)).toEqual([
      "dir:.",
      "dir:frete",
      "dir:legado",
      "dir:pedidos",
    ]);
    expect(breadcrumbItems()).toEqual(["loja"]);
  });

  it("shows Pasta não encontrada: <path> for a missing folder (PROJ-05)", async () => {
    projectMock.mockResolvedValue({
      error: "not-found",
      path: "C:\\nao\\existe",
    });
    render(<App />);
    openFolder("C:\\nao\\existe");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Pasta não encontrada: C:\\nao\\existe",
    );
    expect(screen.queryByTestId("canvas")).toBeNull();
  });

  it("shows the empty-folder message for a project with no .py file", async () => {
    projectMock.mockResolvedValue({
      name: "vazia",
      graph: {
        language: "python",
        empty: true,
        nodes: [],
        edges: [],
        project: { name: "vazia" },
      },
      files: [],
      ignored: [],
    });
    render(<App />);
    openFolder();
    expect(
      await screen.findByText("Nenhum arquivo .py encontrado na pasta."),
    ).toBeTruthy();
    expect(screen.queryByTestId("canvas")).toBeNull();
  });

  it("lists the ignored files with their reason (PROJ-06)", async () => {
    projectMock.mockResolvedValue({
      ...loja,
      ignored: [{ path: "grande.py", reason: "too-large" }],
    });
    render(<App />);
    openFolder();
    const section = await screen.findByRole("region", {
      name: "Arquivos ignorados",
    });
    expect(
      within(section)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["grande.py — maior que 1 MB"]);
  });

  it("replaces the folder map with a snippet map: Trecho is back and Arquivos ignorados is gone", async () => {
    projectMock.mockResolvedValue({
      ...loja,
      ignored: [{ path: "grande.py", reason: "too-large" }],
    });
    graphMock.mockResolvedValue(graph);
    render(<App />);
    openFolder();
    await screen.findByRole("region", { name: "Arquivos ignorados" });
    fireEvent.change(screen.getByLabelText("Trecho Python"), {
      target: { value: source },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gerar mapa" }));
    await waitFor(() => expect(breadcrumbItems()).toEqual(["Trecho"]));
    expect(
      screen.queryByRole("region", { name: "Arquivos ignorados" }),
    ).toBeNull();
    expect(currentCanvas().graph).toEqual(graph);
  });

  it("gives the panel the file's code, its path and the root origin", async () => {
    projectMock.mockResolvedValue(loja);
    explainMock.mockResolvedValue({ status: "no-key" });
    render(<App />);
    openFolder();
    await screen.findByTestId("canvas");
    act(() =>
      currentCanvas().onSelect("file:frete/calculo.py/fn:calcular_frete"),
    );
    expect(
      await screen.findByText("Configure OPENROUTER_API_KEY para ver resumos"),
    ).toBeTruthy();
    expect(screen.getByText("frete/calculo.py")).toBeTruthy();
    expect(screen.getByText("def calcular_frete(peso):")).toBeTruthy();
    expect(explainMock).toHaveBeenCalledWith(
      { root: lojaRoot },
      "file:frete/calculo.py/fn:calcular_frete",
    );
  });
});

function lojaNode(id: string): FlowNode {
  const n = lojaGraph.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
}

describe("App calls in a project (PROJ-04)", () => {
  it("jumps to the called function's file when the call goes to another file", async () => {
    // VID-23: opening a node also shows its panel, which asks for a summary.
    explainMock.mockResolvedValue({ status: "no-key" });
    projectMock.mockResolvedValue(loja);
    render(<App />);
    openFolder();
    await screen.findByTestId("canvas");
    for (const id of [
      "dir:pedidos",
      "file:pedidos/pedidos.py",
      "file:pedidos/pedidos.py/fn:processar_pedido",
    ]) {
      act(() => currentCanvas().onOpen(lojaNode(id)));
    }
    expect(breadcrumbItems()).toEqual([
      "loja",
      "pedidos",
      "pedidos.py",
      "processar_pedido",
    ]);
    act(() =>
      currentCanvas().onOpen(
        lojaNode("file:pedidos/pedidos.py/fn:processar_pedido/s1"),
      ),
    );
    expect(breadcrumbItems()).toEqual([
      "loja",
      "frete",
      "calculo.py",
      "calcular_frete",
    ]);
    expect(currentCanvas().levelId).toBe(
      "file:frete/calculo.py/fn:calcular_frete",
    );
  });

  it("stacks a call to a function of the same file, like a snippet", async () => {
    // VID-23: opening a node also shows its panel, which asks for a summary.
    explainMock.mockResolvedValue({ status: "no-key" });
    const node = (n: Partial<FlowNode> & Pick<FlowNode, "id" | "kind">) =>
      ({
        label: n.id,
        parentId: null,
        range: { start: 1, end: 1 },
        openable: true,
        ...n,
      }) as FlowNode;
    const sameFile: Graph = {
      language: "python",
      empty: false,
      project: { name: "p" },
      edges: [],
      nodes: [
        node({ id: "file:a.py", kind: "file", label: "a.py", path: "a.py" }),
        node({
          id: "file:a.py/fn:f",
          kind: "function",
          label: "f",
          parentId: "file:a.py",
        }),
        node({
          id: "file:a.py/fn:g",
          kind: "function",
          label: "g",
          parentId: "file:a.py",
        }),
        node({
          id: "file:a.py/fn:f/s0",
          kind: "call",
          label: "g",
          parentId: "file:a.py/fn:f",
          target: "file:a.py/fn:g",
        }),
      ],
    };
    projectMock.mockResolvedValue({
      name: "p",
      graph: sameFile,
      files: [],
      ignored: [],
    });
    render(<App />);
    openFolder();
    await screen.findByTestId("canvas");
    const byId = (id: string) =>
      sameFile.nodes.find((n) => n.id === id) as FlowNode;
    act(() => currentCanvas().onOpen(byId("file:a.py")));
    act(() => currentCanvas().onOpen(byId("file:a.py/fn:f")));
    expect(breadcrumbItems()).toEqual(["p", "a.py", "f"]);
    act(() => currentCanvas().onOpen(byId("file:a.py/fn:f/s0")));
    expect(breadcrumbItems()).toEqual(["p", "a.py", "f", "g"]);
  });
});
