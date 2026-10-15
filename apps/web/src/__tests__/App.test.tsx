import type {
  FlowNode,
  Graph,
  GraphResponse,
  LanguageInfo,
  ProjectResponse,
  SnippetLanguage,
  Suggestion,
  Summary,
} from "@8n8/model";
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
import {
  fetchGraph,
  fetchHistory,
  fetchHistoryEntry,
  fetchLanguages,
  fetchProject,
  fetchSettings,
  fetchSuggestions,
  fetchSummary,
  fetchTitles,
} from "../api";
import { lojaGraph } from "../flow/__tests__/loja-graph";
import { videoGraph } from "../flow/__tests__/video-graph";
import type { FlowCanvasProps } from "../flow/FlowCanvas";
import { projectLevel } from "../flow/project-level";
import { pedidoFreteGraph } from "../panel/__tests__/pedido-frete-graph";

vi.mock("../api", () => ({
  fetchGraph: vi.fn(),
  fetchLanguages: vi.fn(),
  fetchSummary: vi.fn(),
  fetchSuggestions: vi.fn(),
  fetchSettings: vi.fn(async () => null),
  saveSettings: vi.fn(),
  fetchProject: vi.fn(),
  fetchTitles: vi.fn(),
  fetchHistory: vi.fn(),
  fetchHistoryEntry: vi.fn(),
  deleteHistory: vi.fn(),
  starHistory: vi.fn(),
}));

let canvas: FlowCanvasProps | null = null;
vi.mock("../flow/FlowCanvas", () => ({
  FlowCanvas: (props: FlowCanvasProps) => {
    canvas = props;
    return <div data-testid="canvas" />;
  },
}));

const graphMock = vi.mocked(fetchGraph);
const explainMock = vi.mocked(fetchSummary);
const suggestMock = vi.mocked(fetchSuggestions);
const projectMock = vi.mocked(fetchProject);
const titlesMock = vi.mocked(fetchTitles);
const historyMock = vi.mocked(fetchHistory);
const historyEntryMock = vi.mocked(fetchHistoryEntry);
const languagesMock = vi.mocked(fetchLanguages);

beforeEach(() => {
  canvas = null;
  graphMock.mockReset();
  explainMock.mockReset();
  suggestMock.mockReset();
  suggestMock.mockResolvedValue({ status: "not-cached" });
  projectMock.mockReset();
  titlesMock.mockReset();
  historyMock.mockReset();
  historyEntryMock.mockReset();
  languagesMock.mockReset();
  languagesMock.mockResolvedValue([]);
  titlesMock.mockResolvedValue([]);
  historyMock.mockResolvedValue([]);
});
afterEach(cleanup);

const python: LanguageInfo = {
  id: "python",
  label: "Python",
  extensions: [".py"],
};
const typescript: LanguageInfo = {
  id: "typescript",
  label: "TypeScript",
  extensions: [".ts", ".tsx"],
};
const detected = (
  language: LanguageInfo,
  uncertain = false,
): SnippetLanguage => ({ id: language.id, label: language.label, uncertain });

function withLanguage(
  graph: Graph,
  language: SnippetLanguage = detected(python),
): GraphResponse {
  return { graph, language };
}

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

const explanation: Summary = {
  summary: "Devolve o peso.",
  sentences: [{ id: "s1", text: "Devolve o peso.", lines: [2] }],
  inputs: [{ id: "i1", text: "peso", lines: [1] }],
  outputs: [{ id: "o1", text: "peso", lines: [2] }],
};

const twoSuggestions: Suggestion[] = [
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
];

async function generate(text = source) {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Colar trecho/ }));
  fireEvent.change(screen.getByLabelText("Trecho de código"), {
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
    graphMock.mockResolvedValue(withLanguage(graph));
    await generate();
    await screen.findByTestId("canvas");
    expect(graphMock).toHaveBeenCalledWith(source);
    expect(currentCanvas().graph).toEqual(graph);
    expect(currentCanvas().levelId).toBeNull();
  });

  it("shows the empty message for an empty graph (CORE-07)", async () => {
    graphMock.mockResolvedValue(
      withLanguage({ ...graph, empty: true, nodes: [] }),
    );
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

  it("passes the suggestion count 2 to the canvas once the suggestions come (CORE-23, CFG-10)", async () => {
    graphMock.mockResolvedValue(withLanguage(graph));
    explainMock.mockResolvedValue({
      status: "ok",
      result: explanation,
      fromCache: false,
      review: "full",
    });
    suggestMock.mockResolvedValue({
      status: "ok",
      result: twoSuggestions,
      fromCache: true,
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
    expect(explainMock).toHaveBeenCalledWith(
      { source },
      "fn:calcular_frete",
      true,
    );
  });

  it("keeps the graph on the canvas when the explanation fails (CORE-20)", async () => {
    graphMock.mockResolvedValue(withLanguage(graph));
    explainMock.mockResolvedValue({ status: "error", message: "HTTP 502" });
    await generate();
    await screen.findByTestId("canvas");
    act(() => currentCanvas().onSelect("fn:calcular_frete"));
    expect(await screen.findByText("Resumo indisponível")).toBeTruthy();
    expect(screen.getByTestId("canvas")).toBeTruthy();
    expect(currentCanvas().graph).toEqual(graph);
  });

  it("returns the canvas to the top level when Fluxo principal is clicked after opening a node (CORE-15, VID-19)", async () => {
    // VID-23: opening a node also shows its panel, which asks for a summary.
    explainMock.mockResolvedValue({ status: "no-key" });
    graphMock.mockResolvedValue(withLanguage(graph));
    await generate();
    await screen.findByTestId("canvas");
    act(() => currentCanvas().onOpen(fnNode));
    expect(currentCanvas().levelId).toBe("fn:calcular_frete");
    fireEvent.click(screen.getByRole("button", { name: "Fluxo principal" }));
    expect(currentCanvas().levelId).toBeNull();
  });

  it("shows the graph-derived external effects of calcular_frete without a summary (FID-14)", async () => {
    graphMock.mockResolvedValue(withLanguage(pedidoFreteGraph));
    explainMock.mockResolvedValue({ status: "no-key" });
    await generate();
    await screen.findByTestId("canvas");
    act(() => currentCanvas().onSelect("fn:calcular_frete"));
    expect(
      await screen.findByText("Configure um provedor de LLM em Configurações."),
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
  fireEvent.click(screen.getByRole("button", { name: "Mapear pasta" }));
}

function breadcrumbItems() {
  return within(
    screen.getByRole("navigation", { name: "Caminho de navegação" }),
  )
    .getAllByRole("button")
    .map((b) => b.textContent);
}

describe("App with a local folder (PROJ-02, PROJ-05, PROJ-06)", () => {
  it("maps the folder: 5 nodes at the top and the breadcrumb starts with loja", async () => {
    projectMock.mockResolvedValue(loja);
    render(<App />);
    openFolder();
    await screen.findByTestId("canvas");
    expect(projectMock).toHaveBeenCalledWith(lojaRoot, []);
    const { graph, levelId } = currentCanvas();
    expect(projectLevel(graph, levelId).nodes.map((n) => n.id)).toEqual([
      "dir:frete",
      "dir:legado",
      "dir:pedidos",
      "file:main.py",
      "file:relatorio.py",
    ]);
    expect(breadcrumbItems()).toEqual(["loja"]);
  });

  it("opens the folder the CLI asked for without any typing (DIST-01)", async () => {
    projectMock.mockResolvedValue(loja);
    render(<App initialFolder={lojaRoot} />);
    await screen.findByTestId("canvas");
    expect(projectMock).toHaveBeenCalledWith(lojaRoot, []);
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
    languagesMock.mockResolvedValue([python]);
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
    fireEvent.click(
      await screen.findByRole("button", { name: "1 arquivo ignorado" }),
    );
    const section = screen.getByRole("region", { name: "Arquivos ignorados" });
    expect(
      within(section)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["grande.pymaior que 1 MB"]);
  });

  it("a second large file put on the map keeps the first one (CLEAN-06, CLEAN-07)", async () => {
    const big = (path: string) => ({
      path,
      reason: "too-large" as const,
      addable: true,
    });
    projectMock
      .mockResolvedValueOnce({ ...loja, ignored: [big("a.py"), big("b.py")] })
      .mockResolvedValueOnce({ ...loja, ignored: [big("b.py")] })
      .mockResolvedValueOnce(loja);
    explainMock.mockResolvedValue({ status: "no-key" });
    render(<App />);
    openFolder();
    fireEvent.click(
      await screen.findByRole("button", { name: "2 arquivos ignorados" }),
    );
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Adicionar ao mapa",
      })[0] as HTMLElement,
    );
    // The list stays open after the re-read, with the file left.
    await screen.findByRole("button", { name: "1 arquivo ignorado" });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar ao mapa" }));
    await waitFor(() =>
      expect(projectMock).toHaveBeenLastCalledWith(lojaRoot, ["a.py", "b.py"]),
    );
    await screen.findByTestId("canvas");
    act(() =>
      currentCanvas().onSelect("file:frete/calculo.py/fn:calcular_frete"),
    );
    await waitFor(() =>
      expect(explainMock).toHaveBeenCalledWith(
        { root: lojaRoot, include: ["a.py", "b.py"] },
        "file:frete/calculo.py/fn:calcular_frete",
        true,
      ),
    );
  });

  it("puts a large file on the map: reads the folder again with it, and every request of the map carries it (CLEAN-06, CLEAN-07)", async () => {
    const grande = { path: "grande.py", source: "x = 1\n" };
    projectMock
      .mockResolvedValueOnce({
        ...loja,
        ignored: [{ path: "grande.py", reason: "too-large", addable: true }],
      })
      .mockResolvedValueOnce({ ...loja, files: [...loja.files, grande] });
    explainMock.mockResolvedValue({ status: "no-key" });
    render(<App />);
    openFolder();
    fireEvent.click(
      await screen.findByRole("button", { name: "1 arquivo ignorado" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Adicionar ao mapa" }));
    await waitFor(() =>
      expect(projectMock).toHaveBeenLastCalledWith(lojaRoot, ["grande.py"]),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "1 arquivo ignorado" }),
      ).toBeNull(),
    );
    const origin = { root: lojaRoot, include: ["grande.py"] };
    // A level with functions asks for titles.
    for (const id of ["dir:pedidos", "file:pedidos/pedidos.py"]) {
      act(() => currentCanvas().onOpen(lojaNode(id)));
    }
    await waitFor(() =>
      expect(titlesMock.mock.calls.at(-1)?.[0]).toEqual(origin),
    );
    act(() =>
      currentCanvas().onSelect("file:frete/calculo.py/fn:calcular_frete"),
    );
    await waitFor(() =>
      expect(explainMock).toHaveBeenCalledWith(
        origin,
        "file:frete/calculo.py/fn:calcular_frete",
        true,
      ),
    );
  });

  it("replaces the folder map with a snippet map: Fluxo principal is back and Arquivos ignorados is gone", async () => {
    projectMock.mockResolvedValue({
      ...loja,
      ignored: [{ path: "grande.py", reason: "too-large" }],
    });
    graphMock.mockResolvedValue(withLanguage(graph));
    render(<App />);
    openFolder();
    await screen.findByRole("button", { name: "1 arquivo ignorado" });
    fireEvent.click(screen.getByRole("button", { name: "Novo código" }));
    fireEvent.click(screen.getByRole("button", { name: /Colar trecho/ }));
    fireEvent.change(screen.getByLabelText("Trecho de código"), {
      target: { value: source },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gerar mapa" }));
    await waitFor(() => expect(breadcrumbItems()).toEqual(["Fluxo principal"]));
    expect(
      screen.queryByRole("button", { name: "1 arquivo ignorado" }),
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
      await screen.findByText("Configure um provedor de LLM em Configurações."),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "CÓDIGO · frete/calculo.py, linhas 1 a 4",
      }),
    ).toBeTruthy();
    expect(screen.getByText("def calcular_frete(peso):")).toBeTruthy();
    expect(explainMock).toHaveBeenCalledWith(
      { root: lojaRoot },
      "file:frete/calculo.py/fn:calcular_frete",
      true,
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
      "Processar pedido",
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
      "Calcular frete",
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
    expect(breadcrumbItems()).toEqual(["p", "a.py", "F"]);
    act(() => currentCanvas().onOpen(byId("file:a.py/fn:f/s0")));
    expect(breadcrumbItems()).toEqual(["p", "a.py", "F", "G"]);
  });
});

const videoSource = [
  "import json",
  "",
  "import requests",
  "",
  "",
  "def processar_pedido(req):",
  "    pedido = json.loads(req.body)",
  "    validar_pedido(pedido)",
  '    cliente = db.buscar_cliente(pedido["cliente_id"])',
  "    frete = calcular_frete(pedido, cliente.cep)",
  "    total = soma_itens(pedido) + frete",
  "    db.salvar(pedido, total)",
  "    enviar_email(cliente.email, total)",
  '    return {"ok": True, "total": total}',
  "",
  "",
  "def calcular_frete(pedido, cep):",
  '    uf = requests.get("https://viacep.com.br/ws/" + cep).json()["uf"]',
  '    peso = sum(item["peso"] for item in pedido["itens"])',
  "    if peso > 30:",
  "        return TABELA_PESADA[uf]",
  "    else:",
  "        return TABELA_PADRAO[uf]",
  "",
].join("\n");
const P = "fn:processar_pedido";
const videoNode = (id: string) =>
  videoGraph.nodes.find((n) => n.id === id) as FlowNode;

async function mapVideo() {
  graphMock.mockResolvedValue(withLanguage(videoGraph));
  explainMock.mockResolvedValue({ status: "no-key" });
  await generate(videoSource);
  await screen.findByTestId("canvas");
}

describe("App, editor and map (VID-08, VID-09)", () => {
  it("shows how many nodes the level has", async () => {
    await mapVideo();
    expect(screen.getByText("8 nós")).toBeTruthy();
  });

  it("opens on the launcher: the folder field, Mapear pasta, Colar trecho and no editor", () => {
    render(<App />);
    expect(screen.getByLabelText("Caminho da pasta")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mapear pasta" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Colar trecho/ })).toBeTruthy();
    expect(screen.queryByLabelText("Trecho de código")).toBeNull();
    expect(screen.queryByRole("button", { name: "Novo código" })).toBeNull();
  });

  it("Colar trecho shows the editor: trecho, the code area, Gerar mapa and Início back to the launcher", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Colar trecho/ }));
    const editor = screen.getByRole("region", { name: "Editor" });
    expect(within(editor).getByText("trecho")).toBeTruthy();
    expect(within(editor).getByLabelText("Trecho de código").tagName).toBe(
      "TEXTAREA",
    );
    expect(screen.getByRole("button", { name: "Gerar mapa" }).className).toBe(
      "btn",
    );
    expect(screen.queryByLabelText("Caminho da pasta")).toBeNull();
    expect(screen.queryByRole("button", { name: "Novo código" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Início" }));
    expect(screen.queryByLabelText("Trecho de código")).toBeNull();
    expect(screen.getByLabelText("Caminho da pasta")).toBeTruthy();
  });

  it("keeps long code lines unwrapped and hints the folder field", () => {
    render(<App />);
    expect(
      screen.getByLabelText("Caminho da pasta").getAttribute("placeholder"),
    ).toBe(String.raw`C:\projetos\loja`);
    fireEvent.click(screen.getByRole("button", { name: /Colar trecho/ }));
    expect(screen.getByLabelText("Trecho de código").getAttribute("wrap")).toBe(
      "off",
    );
  });

  it("swaps the editor for the map, and Novo código goes back with the text kept", async () => {
    await mapVideo();
    expect(screen.queryByLabelText("Trecho de código")).toBeNull();
    expect(screen.queryByRole("region", { name: "Editor" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Novo código" }));
    expect(screen.queryByTestId("canvas")).toBeNull();
    expect(
      (screen.getByLabelText("Trecho de código") as HTMLTextAreaElement).value,
    ).toBe(videoSource);
  });

  it("keeps the folder field when Novo código goes back to the launcher", async () => {
    projectMock.mockResolvedValue(loja);
    render(<App />);
    openFolder();
    await screen.findByTestId("canvas");
    fireEvent.click(screen.getByRole("button", { name: "Novo código" }));
    expect(
      (screen.getByLabelText("Caminho da pasta") as HTMLInputElement).value,
    ).toBe(lojaRoot);
  });

  it("stays in the editor for an empty graph (CORE-07)", async () => {
    graphMock.mockResolvedValue(
      withLanguage({ ...graph, empty: true, nodes: [] }),
    );
    await generate("# só comentário");
    await screen.findByText("Nenhuma função ou instrução encontrada.");
    expect(screen.getByLabelText("Trecho de código")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Novo código" })).toBeNull();
  });

  it("shows Pasta não encontrada on the launcher, and the message goes on Colar trecho", async () => {
    projectMock.mockResolvedValue({ error: "not-found", path: "C:/nada" });
    render(<App />);
    openFolder("C:/nada");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Pasta não encontrada: C:/nada",
    );
    expect(screen.getByLabelText("Caminho da pasta")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Colar trecho/ }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the failure alert in the editor", async () => {
    graphMock.mockRejectedValue(new Error("HTTP 400"));
    await generate();
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Trecho de código")).toBeTruthy();
  });

  it("starts a new map at the top level with nothing selected", async () => {
    await mapVideo();
    act(() => currentCanvas().onOpen(videoNode(P)));
    expect(currentCanvas().levelId).toBe(P);
    fireEvent.click(screen.getByRole("button", { name: "Novo código" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar mapa" }));
    await waitFor(() => expect(currentCanvas().levelId).toBeNull());
    expect(currentCanvas().selected).toBeNull();
    expect(currentCanvas().depth).toBe(0);
  });
});

describe("App, Voltar and Esc (VID-19, VID-23, VID-27)", () => {
  const voltar = () =>
    screen.getByRole("button", { name: "Voltar" }) as HTMLButtonElement;

  it("disables Voltar on the top level, and Esc does nothing there", async () => {
    await mapVideo();
    expect(voltar().disabled).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(currentCanvas().levelId).toBeNull();
    expect(currentCanvas().selected).toBeNull();
  });

  it("opens with one click, and Voltar goes back with the opened card selected and focused", async () => {
    await mapVideo();
    act(() => currentCanvas().onOpen(videoNode(P)));
    act(() => currentCanvas().onOpen(videoNode(`${P}/s3`)));
    expect(currentCanvas().levelId).toBe("fn:calcular_frete");
    expect(breadcrumbItems()).toEqual([
      "Fluxo principal",
      "Processar pedido",
      "Calcular frete",
    ]);
    expect(voltar().disabled).toBe(false);
    fireEvent.click(voltar());
    expect(currentCanvas().levelId).toBe(P);
    expect(currentCanvas().selected).toBe(`${P}/s3`);
    expect(currentCanvas().focusId).toBe(`${P}/s3`);
  });

  it("goes back one level with Esc", async () => {
    await mapVideo();
    act(() => currentCanvas().onOpen(videoNode(P)));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(currentCanvas().levelId).toBeNull();
    expect(currentCanvas().selected).toBe(P);
    expect(currentCanvas().focusId).toBe(P);
  });

  it("does not navigate on Esc inside an editable field", async () => {
    await mapVideo();
    act(() => currentCanvas().onOpen(videoNode(P)));
    const field = document.createElement("textarea");
    document.body.append(field);
    fireEvent.keyDown(field, { key: "Escape" });
    field.remove();
    expect(currentCanvas().levelId).toBe(P);
  });

  it("shows the code of the open level when its breadcrumb item is clicked after a leaf was selected", async () => {
    await mapVideo();
    act(() => currentCanvas().onOpen(videoNode(P)));
    act(() => currentCanvas().onSelect(`${P}/s0`));
    expect(currentCanvas().selected).toBe(`${P}/s0`);
    const crumbs = within(
      screen.getByRole("navigation", { name: "Caminho de navegação" }),
    ).getAllByRole("button");
    fireEvent.click(crumbs[crumbs.length - 1] as HTMLElement);
    expect(currentCanvas().levelId).toBe(P);
    expect(currentCanvas().selected).toBe(P);
    expect(explainMock).toHaveBeenLastCalledWith(
      { source: videoSource },
      P,
      true,
    );
  });

  it("shows the panel of the called function when a call card is open (VID-23, VID-24)", async () => {
    await mapVideo();
    act(() => currentCanvas().onOpen(videoNode(P)));
    act(() => currentCanvas().onOpen(videoNode(`${P}/s3`)));
    expect(
      screen.getByRole("heading", { level: 2, name: "Calcular frete" }),
    ).toBeTruthy();
    expect(explainMock).toHaveBeenLastCalledWith(
      { source: videoSource },
      "fn:calcular_frete",
      true,
    );
  });
});

describe("App, titles, code lines and suggestion cards (VID-14, VID-33)", () => {
  it("asks for the titles of the visible level and passes them to the canvas and the breadcrumb", async () => {
    titlesMock.mockResolvedValue([
      { nodeId: P, text: "Recebe o pedido", lines: [6], fromCache: false },
    ]);
    await mapVideo();
    expect(titlesMock).toHaveBeenCalledTimes(1);
    expect(titlesMock).toHaveBeenCalledWith(
      { source: videoSource },
      projectLevel(videoGraph, null).nodes.map((n) => n.id),
    );
    await waitFor(() =>
      expect(currentCanvas().titles.get(P)).toBe("Recebe o pedido"),
    );
    act(() => currentCanvas().onOpen(videoNode(P)));
    expect(breadcrumbItems()).toEqual(["Fluxo principal", "Recebe o pedido"]);
  });

  it("gives the canvas the code line read from the snippet", async () => {
    await mapVideo();
    expect(currentCanvas().codeLineOf(videoNode(`${P}/s7`))).toBe(
      'return {"ok": True, "total": to…',
    );
  });

  it("selects the explained node and marks the suggestion's line on a card click, again on a second click", async () => {
    await mapVideo();
    explainMock.mockResolvedValue({
      status: "ok",
      result: {
        summary: "Processa o pedido.",
        sentences: [{ id: "s1", text: "Processa o pedido.", lines: [6] }],
        inputs: [],
        outputs: [],
      },
      fromCache: false,
      review: "full",
    });
    act(() => currentCanvas().onSuggestion(P, 13));
    expect(currentCanvas().selected).toBe(P);
    const marked = () =>
      [...document.querySelectorAll("[aria-current]")].map((el) =>
        el.getAttribute("data-line"),
      );
    await waitFor(() => expect(marked()).toEqual(["13"]));
    expect(
      screen.getByRole("heading", { level: 2, name: "Processar pedido" }),
    ).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "L6" }));
    expect(marked()).toEqual(["6"]);
    act(() => currentCanvas().onSuggestion(P, 13));
    expect(marked()).toEqual(["13"]);
  });
});

describe("App, explanations kept per map", () => {
  const summary = (text: string) => ({
    status: "ok" as const,
    result: {
      summary: text,
      sentences: [{ id: "s1", text, lines: [7] }],
      inputs: [],
      outputs: [],
    },
    fromCache: false,
    review: "full" as const,
  });
  const asked = (id: string) =>
    explainMock.mock.calls.filter(([, nodeId]) => nodeId === id).length;

  it("asks for a node's explanation once per map, and again after a new map", async () => {
    await mapVideo();
    explainMock.mockImplementation(async (_origin, id) =>
      summary(`Resumo ${id}.`),
    );
    act(() => currentCanvas().onSelect(`${P}/s1`));
    expect(await screen.findByText(`Resumo ${P}/s1.`)).toBeTruthy();
    act(() => currentCanvas().onSelect(`${P}/s2`));
    expect(await screen.findByText(`Resumo ${P}/s2.`)).toBeTruthy();
    act(() => currentCanvas().onSelect(`${P}/s1`));
    expect(await screen.findByText(`Resumo ${P}/s1.`)).toBeTruthy();
    expect(asked(`${P}/s1`)).toBe(1);
    expect(asked(`${P}/s2`)).toBe(1);

    // "Novo código" and "Gerar mapa": a new map asks again.
    fireEvent.click(screen.getByRole("button", { name: "Novo código" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar mapa" }));
    await screen.findByTestId("canvas");
    await waitFor(() => expect(currentCanvas().selected).toBeNull());
    act(() => currentCanvas().onSelect(`${P}/s1`));
    expect(await screen.findByText(`Resumo ${P}/s1.`)).toBeTruthy();
    expect(asked(`${P}/s1`)).toBe(2);
  });

  it("asks again after a failure", async () => {
    await mapVideo();
    explainMock.mockResolvedValue({ status: "error", message: "HTTP 502" });
    act(() => currentCanvas().onSelect(`${P}/s1`));
    expect(await screen.findByText("Resumo indisponível")).toBeTruthy();
    act(() => currentCanvas().onSelect(`${P}/s2`));
    await waitFor(() => expect(asked(`${P}/s2`)).toBe(1));
    act(() => currentCanvas().onSelect(`${P}/s1`));
    await waitFor(() => expect(asked(`${P}/s1`)).toBe(2));
  });
});

describe("App: history", () => {
  const item = {
    id: 9,
    kind: "snippet" as const,
    title: "def calcular_frete(peso):",
    createdAt: 0,
    openedAt: Date.now(),
    openCount: 1,
    lines: 2,
    bytes: 40,
    files: 1,
    nodes: 2,
    edges: 1,
    starred: false,
  };
  const drawer = () => screen.getByRole("complementary", { name: "Histórico" });

  it("opens a map from the launcher's Recentes by generating it from the saved text (CLEAN-09)", async () => {
    historyMock.mockResolvedValue([item]);
    historyEntryMock.mockResolvedValue({
      kind: "snippet",
      source,
      language: "python",
    });
    graphMock.mockResolvedValue(withLanguage(graph));
    render(<App />);
    const recent = await screen.findByRole("region", { name: "Recentes" });
    fireEvent.click(
      within(recent).getByRole("button", { name: /^def calcular_frete/ }),
    );
    await waitFor(() => expect(breadcrumbItems()).toEqual(["Fluxo principal"]));
    expect(graphMock).toHaveBeenCalledWith(source);
  });

  it("opens a saved snippet by generating its map again from the text (CLEAN-09)", async () => {
    historyMock.mockResolvedValue([item]);
    historyEntryMock.mockResolvedValue({
      kind: "snippet",
      source,
      language: "python",
    });
    graphMock.mockResolvedValue(withLanguage(graph));
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "Ver todo o histórico" }),
    );
    fireEvent.click(
      await within(drawer()).findByRole("button", {
        name: /^def calcular_frete/,
      }),
    );
    await waitFor(() => expect(breadcrumbItems()).toEqual(["Fluxo principal"]));
    expect(historyEntryMock).toHaveBeenCalledWith(9);
    expect(currentCanvas().graph).toEqual(graph);
    expect(graphMock).toHaveBeenCalledWith(source);
    expect(projectMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("complementary", { name: "Histórico" }),
    ).toBeNull();
  });

  it("opens a saved project by reading its folder again, and the hamburger stays on the map (CLEAN-09)", async () => {
    historyMock.mockResolvedValue([
      { ...item, kind: "project", title: "loja" },
    ]);
    historyEntryMock.mockResolvedValue({
      kind: "project",
      root: "C:/codigo/loja",
    });
    projectMock.mockResolvedValue({
      ...loja,
      ignored: [{ path: "g.py", reason: "too-large" }],
    });
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "Ver todo o histórico" }),
    );
    fireEvent.click(
      await within(drawer()).findByRole("button", { name: /^loja/ }),
    );
    await screen.findByRole("button", { name: "1 arquivo ignorado" });
    expect(projectMock).toHaveBeenCalledWith("C:/codigo/loja", []);
    expect(screen.getByRole("button", { name: "Histórico" })).toBeTruthy();
  });

  it("says the folder is gone when a saved project no longer exists (CLEAN-09)", async () => {
    historyMock.mockResolvedValue([
      { ...item, kind: "project", title: "loja" },
    ]);
    historyEntryMock.mockResolvedValue({
      kind: "project",
      root: "C:/codigo/loja",
    });
    projectMock.mockResolvedValue({
      error: "not-found",
      path: "C:/codigo/loja",
    });
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "Ver todo o histórico" }),
    );
    fireEvent.click(
      await within(drawer()).findByRole("button", { name: /^loja/ }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Pasta não encontrada: C:/codigo/loja",
    );
    expect(
      await screen.findByRole("region", { name: "Recentes" }),
    ).toBeTruthy();
  });
});

const emptyFolder: ProjectResponse = {
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
};

describe("App, languages from the server (7.1, 7.2)", () => {
  const genericReads =
    "O 8n8 lê os arquivos de código da pasta e das subpastas.";

  it("asks for the languages once, when it mounts", async () => {
    render(<App />);
    await waitFor(() => expect(languagesMock).toHaveBeenCalledTimes(1));
  });

  it("says the extensions of every language on the launcher", async () => {
    languagesMock.mockResolvedValue([python, typescript]);
    render(<App />);
    expect(
      await screen.findByText(
        "O 8n8 lê os arquivos .py, .ts e .tsx da pasta e das subpastas.",
      ),
    ).toBeTruthy();
  });

  it("says it in generic words, with no language, while the list has not arrived", () => {
    render(<App />);
    expect(screen.getByText(genericReads)).toBeTruthy();
  });

  it("keeps the generic words when the list comes empty", async () => {
    render(<App />);
    await waitFor(() => expect(languagesMock).toHaveBeenCalled());
    expect(screen.getByText(genericReads)).toBeTruthy();
    expect(screen.queryByText(/\.py/)).toBeNull();
  });

  it("names the extensions in the empty-folder message, with 'ou'", async () => {
    languagesMock.mockResolvedValue([
      python,
      { id: "typescript", label: "TypeScript", extensions: [".ts"] },
    ]);
    projectMock.mockResolvedValue(emptyFolder);
    render(<App />);
    await screen.findByText(/lê os arquivos \.py e \.ts/);
    openFolder();
    expect(
      await screen.findByText("Nenhum arquivo .py ou .ts encontrado na pasta."),
    ).toBeTruthy();
  });

  it("uses the generic empty-folder message when there is no list", async () => {
    projectMock.mockResolvedValue(emptyFolder);
    render(<App />);
    openFolder();
    expect(
      await screen.findByText("Nenhum arquivo de código encontrado na pasta."),
    ).toBeTruthy();
  });

  it("shows the detected language after Gerar mapa, with no warning when it is certain", async () => {
    graphMock.mockResolvedValue(withLanguage(graph, detected(python)));
    await generate();
    await screen.findByTestId("canvas");
    expect(screen.getByText("Python")).toBeTruthy();
    expect(screen.queryByText(/Linguagem incerta/)).toBeNull();
  });

  it("warns when the language is uncertain", async () => {
    graphMock.mockResolvedValue(
      withLanguage(graph, detected(typescript, true)),
    );
    await generate();
    await screen.findByTestId("canvas");
    expect(
      screen.getByText("Linguagem incerta. Mostrando como TypeScript."),
    ).toBeTruthy();
  });

  it("shows no language label on a project map", async () => {
    languagesMock.mockResolvedValue([python]);
    projectMock.mockResolvedValue(loja);
    render(<App />);
    openFolder();
    await screen.findByTestId("canvas");
    expect(screen.queryByText("Python")).toBeNull();
    expect(screen.queryByText(/Linguagem incerta/)).toBeNull();
  });

  it("names the snippet after the detected language in the panel heading", async () => {
    languagesMock.mockResolvedValue([python, typescript]);
    explainMock.mockResolvedValue({ status: "no-key" });
    graphMock.mockResolvedValue(withLanguage(graph, detected(typescript)));
    render(<App />);
    await screen.findByText(/lê os arquivos \.py, \.ts e \.tsx/);
    fireEvent.click(screen.getByRole("button", { name: /Colar trecho/ }));
    fireEvent.change(screen.getByLabelText("Trecho de código"), {
      target: { value: source },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gerar mapa" }));
    await screen.findByTestId("canvas");
    act(() => currentCanvas().onSelect("fn:calcular_frete"));
    expect(
      await screen.findByRole("heading", {
        name: "CÓDIGO · trecho.ts, linhas 1 a 2",
      }),
    ).toBeTruthy();
  });

  it("names the snippet just 'trecho' when the languages did not arrive", async () => {
    explainMock.mockResolvedValue({ status: "no-key" });
    graphMock.mockResolvedValue(withLanguage(graph));
    await generate();
    await screen.findByTestId("canvas");
    act(() => currentCanvas().onSelect("fn:calcular_frete"));
    expect(
      await screen.findByRole("heading", {
        name: "CÓDIGO · trecho, linhas 1 a 2",
      }),
    ).toBeTruthy();
  });
});

describe("App settings (CFG-08, CFG-20)", () => {
  const settingsMock = vi.mocked(fetchSettings);
  const view = {
    provider: "openrouter",
    model: "m/x",
    autoSummary: true,
    autoSuggestions: false,
    hasKey: true,
    providers: [{ id: "openrouter", defaultModel: "m/x", usesKey: true }],
    env: {},
  };

  it("opens the settings dialog from the start screen", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    expect(
      await screen.findByRole("dialog", { name: "Configurações" }),
    ).toBeTruthy();
  });

  it("asks the parts the settings make automatic for real, and the others from the cache", async () => {
    settingsMock.mockResolvedValueOnce(view);
    graphMock.mockResolvedValue(withLanguage(graph));
    explainMock.mockResolvedValue({ status: "no-key" });
    await generate();
    await screen.findByTestId("canvas");
    await waitFor(() => expect(settingsMock).toHaveBeenCalled());
    // Let the settings land before the node is selected.
    await act(async () => {});
    act(() => currentCanvas().onSelect("fn:calcular_frete"));
    await waitFor(() =>
      expect(explainMock).toHaveBeenCalledWith(
        { source },
        "fn:calcular_frete",
        false,
      ),
    );
    expect(suggestMock).toHaveBeenCalledWith(
      { source },
      "fn:calcular_frete",
      true,
    );
  });

  it("opens the settings from the panel's no-provider notice", async () => {
    graphMock.mockResolvedValue(withLanguage(graph));
    explainMock.mockResolvedValue({ status: "no-key" });
    await generate();
    await screen.findByTestId("canvas");
    act(() => currentCanvas().onSelect("fn:calcular_frete"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Abrir configurações" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Configurações" }),
    ).toBeTruthy();
  });
});

describe("App settings button in the editor (CFG-20)", () => {
  it("opens the settings dialog from the editor", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Colar trecho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    expect(
      await screen.findByRole("dialog", { name: "Configurações" }),
    ).toBeTruthy();
  });
});
