import type { Explanation, FlowNode, Graph } from "@code2n8n/model";
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
import { fetchExplanation, fetchGraph } from "../api";
import type { FlowCanvasProps } from "../flow/FlowCanvas";
import { pedidoFreteGraph } from "../panel/__tests__/pedido-frete-graph";

vi.mock("../api", () => ({ fetchGraph: vi.fn(), fetchExplanation: vi.fn() }));

let canvas: FlowCanvasProps | null = null;
vi.mock("../flow/FlowCanvas", () => ({
  FlowCanvas: (props: FlowCanvasProps) => {
    canvas = props;
    return <div data-testid="canvas" />;
  },
}));

const graphMock = vi.mocked(fetchGraph);
const explainMock = vi.mocked(fetchExplanation);

beforeEach(() => {
  canvas = null;
  graphMock.mockReset();
  explainMock.mockReset();
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
    expect(explainMock).toHaveBeenCalledWith(source, "fn:calcular_frete");
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
