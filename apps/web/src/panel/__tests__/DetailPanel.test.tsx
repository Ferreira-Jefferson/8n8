import type { Explanation, FlowNode } from "@code2n8n/model";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ExplainResult, fetchExplanation } from "../../api";
import { DetailPanel } from "../DetailPanel";

vi.mock("../../api", () => ({ fetchExplanation: vi.fn() }));
const fetchMock = vi.mocked(fetchExplanation);

beforeEach(() => fetchMock.mockReset());
afterEach(cleanup);

const source = [
  "import requests",
  "",
  "",
  "def calcular_frete(peso, distancia):",
  '    requests.get("https://api.exemplo.com/tabela-frete")',
  "    base = 10",
  "    taxa = distancia * 0.5",
  "    if peso > 30:",
  "        return base + taxa * 2",
  "    else:",
  "        return base + taxa",
].join("\n");

const fnNode: FlowNode = {
  id: "fn:calcular_frete",
  kind: "function",
  label: "calcular_frete",
  parentId: null,
  range: { start: 4, end: 11 },
  openable: true,
};

const httpNode: FlowNode = {
  id: "fn:calcular_frete/s0",
  kind: "external",
  label: "requests.get",
  parentId: "fn:calcular_frete",
  range: { start: 5, end: 5 },
  openable: false,
  callee: "requests.get",
  category: "HTTP",
};

const explanation: Explanation = {
  summary: "Calcula o frete pelo peso e pela distância.",
  inputs: ["peso", "distancia"],
  outputs: ["valor do frete"],
  suggestions: [
    {
      command: "Defina um timeout na chamada HTTP",
      reason: "A chamada pode travar.",
      line: 5,
      severity: "alta",
    },
  ],
};
const ok: ExplainResult = { status: "ok", explanation, fromCache: false };

function codeLines(container: HTMLElement) {
  return [...container.querySelectorAll("[data-line]")].map(
    (el) => el.querySelector("code")?.textContent,
  );
}

describe("DetailPanel", () => {
  it("shows the line range and exact code of an external node without fetching (CORE-14)", () => {
    const { container } = render(
      <DetailPanel source={source} node={httpNode} onExplained={() => {}} />,
    );
    expect(screen.getByText("Linhas 5–5")).toBeTruthy();
    expect(codeLines(container)).toEqual([
      '    requests.get("https://api.exemplo.com/tabela-frete")',
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches once for a function and shows summary, inputs, outputs and suggestions (CORE-16)", async () => {
    fetchMock.mockResolvedValue(ok);
    render(
      <DetailPanel source={source} node={fnNode} onExplained={() => {}} />,
    );
    expect(
      await screen.findByText("Calcula o frete pelo peso e pela distância."),
    ).toBeTruthy();
    expect(screen.getByText("peso")).toBeTruthy();
    expect(screen.getByText("distancia")).toBeTruthy();
    expect(screen.getByText("valor do frete")).toBeTruthy();
    expect(
      screen.getByText("Defina um timeout na chamada HTTP (linha 5, alta)"),
    ).toBeTruthy();
    expect(screen.getByText("A chamada pode travar.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(source, "fn:calcular_frete");
  });

  it("shows the no-key message and keeps the code visible (CORE-19)", async () => {
    fetchMock.mockResolvedValue({ status: "no-key" });
    const { container } = render(
      <DetailPanel source={source} node={fnNode} onExplained={() => {}} />,
    );
    expect(
      await screen.findByText("Configure OPENROUTER_API_KEY para ver resumos"),
    ).toBeTruthy();
    expect(codeLines(container)).toHaveLength(8);
    expect(codeLines(container)[0]).toBe(
      "def calcular_frete(peso, distancia):",
    );
  });

  it("shows Resumo indisponível with Tentar de novo, and retrying shows the summary (CORE-20)", async () => {
    fetchMock
      .mockResolvedValueOnce({ status: "error", message: "HTTP 502" })
      .mockResolvedValueOnce(ok);
    render(
      <DetailPanel source={source} node={fnNode} onExplained={() => {}} />,
    );
    expect(await screen.findByText("Resumo indisponível")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(
      await screen.findByText("Calcula o frete pelo peso e pela distância."),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Resumo indisponível")).toBeNull();
  });

  it("marks the suggestion's line in the code view on click (CORE-24)", async () => {
    fetchMock.mockResolvedValue(ok);
    const { container } = render(
      <DetailPanel source={source} node={fnNode} onExplained={() => {}} />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Defina um timeout na chamada HTTP (linha 5, alta)",
      }),
    );
    const marked = [...container.querySelectorAll("[aria-current]")].map((el) =>
      el.getAttribute("data-line"),
    );
    expect(marked).toEqual(["5"]);
  });

  it("asks to generate the map again when the node is stale", async () => {
    fetchMock.mockResolvedValue({ status: "stale" });
    render(
      <DetailPanel source={source} node={fnNode} onExplained={() => {}} />,
    );
    expect(
      await screen.findByText(
        'O trecho mudou. Clique em "Gerar mapa" de novo.',
      ),
    ).toBeTruthy();
  });

  it("calls onExplained with the node ID and the explanation on ok", async () => {
    fetchMock.mockResolvedValue(ok);
    const onExplained = vi.fn();
    render(
      <DetailPanel source={source} node={fnNode} onExplained={onExplained} />,
    );
    await waitFor(() =>
      expect(onExplained).toHaveBeenCalledWith(
        "fn:calcular_frete",
        explanation,
      ),
    );
  });
});
