import type { Explanation, ExternalEffect, FlowNode } from "@code2n8n/model";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
  summary:
    "Calcula o frete pelo peso e pela distância. Dobra a taxa acima de 30.",
  sentences: [
    {
      id: "s1",
      text: "Calcula o frete pelo peso e pela distância.",
      lines: [4],
    },
    { id: "s2", text: "Dobra a taxa acima de 30.", lines: [8, 9] },
  ],
  inputs: [
    { id: "i1", text: "peso", lines: [4] },
    { id: "i2", text: "distancia", lines: [4] },
  ],
  outputs: [{ id: "o1", text: "valor do frete", lines: [9, 11] }],
  suggestions: [
    {
      id: "g1",
      command: "Defina um timeout na chamada HTTP",
      reason: "A chamada pode travar.",
      line: 5,
      severity: "alta",
      lines: [5],
    },
  ],
};
const ok: ExplainResult = {
  status: "ok",
  explanation,
  fromCache: false,
  review: "full",
};

const requestsGet: ExternalEffect = {
  callee: "requests.get",
  category: "HTTP",
  line: 5,
};

function itemTexts(list: HTMLElement) {
  return within(list)
    .getAllByRole("listitem")
    .map((li) => li.querySelector("span")?.textContent);
}

/** The list right after a section heading ("Entradas", "Saídas"). */
function listAfter(heading: string): HTMLElement {
  const list = screen.getByRole("heading", {
    name: heading,
  }).nextElementSibling;
  if (!(list instanceof HTMLElement))
    throw new Error(`no list after ${heading}`);
  return list;
}

function marked(container: HTMLElement) {
  return [...container.querySelectorAll("[aria-current]")].map((el) =>
    el.getAttribute("data-line"),
  );
}

function claimItem(container: HTMLElement, id: string): HTMLElement {
  const item = container.querySelector<HTMLElement>(`[data-claim-id="${id}"]`);
  if (!item) throw new Error(`no item ${id}`);
  return item;
}

function codeLines(container: HTMLElement) {
  return [...container.querySelectorAll("[data-line]")].map(
    (el) => el.querySelector("code")?.textContent,
  );
}

describe("DetailPanel", () => {
  it("shows the line range and exact code of an external node without fetching (CORE-14)", () => {
    const { container } = render(
      <DetailPanel
        source={source}
        node={httpNode}
        effects={[]}
        onExplained={() => {}}
      />,
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
      <DetailPanel
        source={source}
        node={fnNode}
        effects={[]}
        onExplained={() => {}}
      />,
    );
    expect(
      itemTexts(await screen.findByRole("list", { name: "Resumo" })),
    ).toEqual([
      "Calcula o frete pelo peso e pela distância.",
      "Dobra a taxa acima de 30.",
    ]);
    expect(itemTexts(listAfter("Entradas"))).toEqual(["peso", "distancia"]);
    expect(itemTexts(listAfter("Saídas"))).toEqual(["valor do frete"]);
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
      <DetailPanel
        source={source}
        node={fnNode}
        effects={[]}
        onExplained={() => {}}
      />,
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
      <DetailPanel
        source={source}
        node={fnNode}
        effects={[]}
        onExplained={() => {}}
      />,
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
      <DetailPanel
        source={source}
        node={fnNode}
        effects={[]}
        onExplained={() => {}}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Defina um timeout na chamada HTTP (linha 5, alta)",
      }),
    );
    expect(marked(container)).toEqual(["5"]);
  });

  it("asks to generate the map again when the node is stale", async () => {
    fetchMock.mockResolvedValue({ status: "stale" });
    render(
      <DetailPanel
        source={source}
        node={fnNode}
        effects={[]}
        onExplained={() => {}}
      />,
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
      <DetailPanel
        source={source}
        node={fnNode}
        effects={[]}
        onExplained={onExplained}
      />,
    );
    await waitFor(() =>
      expect(onExplained).toHaveBeenCalledWith(
        "fn:calcular_frete",
        explanation,
      ),
    );
  });

  it.each([
    ["full", "Revisado"],
    ["cut", "Revisado com cortes"],
  ] as const)(
    "shows the review badge for review %s (FID-09, FID-11)",
    async (review, badge) => {
      fetchMock.mockResolvedValue({ ...ok, review } as ExplainResult);
      const { container } = render(
        <DetailPanel
          source={source}
          node={fnNode}
          effects={[]}
          onExplained={() => {}}
        />,
      );
      await screen.findByRole("list", { name: "Resumo" });
      expect(container.querySelector(".review-badge")?.textContent).toBe(badge);
    },
  );

  it("names each claim's evidence button by its lines and marks exactly those lines on click (FID-12, FID-13)", async () => {
    fetchMock.mockResolvedValue(ok);
    const { container } = render(
      <DetailPanel
        source={source}
        node={fnNode}
        effects={[]}
        onExplained={() => {}}
      />,
    );
    await screen.findByRole("list", { name: "Resumo" });
    fireEvent.click(
      within(claimItem(container, "s2")).getByRole("button", { name: "L8–9" }),
    );
    expect(marked(container)).toEqual(["8", "9"]);
    fireEvent.click(
      within(claimItem(container, "s1")).getByRole("button", { name: "L4" }),
    );
    expect(marked(container)).toEqual(["4"]);
  });

  it.each([
    [["neighbours"], "Resumo atualizado: os vizinhos mudaram"],
    [
      ["code", "model-or-prompt"],
      "Resumo atualizado: o código mudou, o modelo ou o prompt mudou",
    ],
  ] as const)(
    "shows the update notice for %j (CACHE-04)",
    async (update, text) => {
      fetchMock.mockResolvedValue({
        ...ok,
        update: [...update],
      } as ExplainResult);
      render(
        <DetailPanel
          source={source}
          node={fnNode}
          effects={[]}
          onExplained={() => {}}
        />,
      );
      expect((await screen.findByRole("status")).textContent).toBe(text);
    },
  );

  it("shows no update notice without update (CACHE-04)", async () => {
    fetchMock.mockResolvedValue(ok);
    render(
      <DetailPanel
        source={source}
        node={fnNode}
        effects={[]}
        onExplained={() => {}}
      />,
    );
    await screen.findByRole("list", { name: "Resumo" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the unfaithful message with Tentar de novo, which fetches again (FID-10)", async () => {
    fetchMock
      .mockResolvedValueOnce({ status: "unfaithful" })
      .mockResolvedValueOnce(ok);
    render(
      <DetailPanel
        source={source}
        node={fnNode}
        effects={[]}
        onExplained={() => {}}
      />,
    );
    expect(
      await screen.findByText("Não foi possível gerar um resumo fiel."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("list", { name: "Resumo" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByText("Não foi possível gerar um resumo fiel."),
    ).toBeNull();
  });

  it("lists the external effects under Efeitos externos (FID-14)", async () => {
    fetchMock.mockResolvedValue(ok);
    render(
      <DetailPanel
        source={source}
        node={fnNode}
        effects={[requestsGet]}
        onExplained={() => {}}
      />,
    );
    await screen.findByRole("list", { name: "Resumo" });
    const list = screen.getByRole("list", { name: "Efeitos externos" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["requests.get (HTTP, linha 5)"]);
  });

  it("places Efeitos externos below the Resumo list (FID-14)", async () => {
    fetchMock.mockResolvedValue(ok);
    render(
      <DetailPanel
        source={source}
        node={fnNode}
        effects={[requestsGet]}
        onExplained={() => {}}
      />,
    );
    const resumo = await screen.findByRole("list", { name: "Resumo" });
    const efeitos = screen.getByRole("heading", { name: "Efeitos externos" });
    expect(
      resumo.compareDocumentPosition(efeitos) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("says Nenhum efeito externo. when there are no effects (FID-14)", async () => {
    fetchMock.mockResolvedValue(ok);
    render(
      <DetailPanel
        source={source}
        node={fnNode}
        effects={[]}
        onExplained={() => {}}
      />,
    );
    await screen.findByRole("list", { name: "Resumo" });
    expect(
      screen.getByRole("heading", { name: "Efeitos externos" }),
    ).toBeTruthy();
    expect(screen.getByText("Nenhum efeito externo.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Efeitos externos" })).toBeNull();
  });

  it.each([
    [
      "no-key",
      { status: "no-key" },
      "Configure OPENROUTER_API_KEY para ver resumos",
    ],
    ["error", { status: "error", message: "HTTP 502" }, "Resumo indisponível"],
  ] as const)(
    "lists the effects when the explanation is %s (FID-14)",
    async (_state, result, message) => {
      fetchMock.mockResolvedValue(result as ExplainResult);
      render(
        <DetailPanel
          source={source}
          node={fnNode}
          effects={[requestsGet]}
          onExplained={() => {}}
        />,
      );
      expect(await screen.findByText(message)).toBeTruthy();
      expect(
        within(
          screen.getByRole("list", { name: "Efeitos externos" }),
        ).getByText("requests.get (HTTP, linha 5)"),
      ).toBeTruthy();
    },
  );

  it("lists the effects while the explanation is loading (FID-14)", async () => {
    let answer: (r: ExplainResult) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    render(
      <DetailPanel
        source={source}
        node={fnNode}
        effects={[requestsGet]}
        onExplained={() => {}}
      />,
    );
    expect(screen.getByText("Gerando resumo…")).toBeTruthy();
    expect(
      within(screen.getByRole("list", { name: "Efeitos externos" })).getByText(
        "requests.get (HTTP, linha 5)",
      ),
    ).toBeTruthy();
    answer({ status: "no-key" });
    await screen.findByText("Configure OPENROUTER_API_KEY para ver resumos");
  });

  it("shows no effects section for an external node (FID-14)", () => {
    render(
      <DetailPanel
        source={source}
        node={httpNode}
        effects={[requestsGet]}
        onExplained={() => {}}
      />,
    );
    expect(screen.queryByText("Efeitos externos")).toBeNull();
    expect(screen.queryByText("Nenhum efeito externo.")).toBeNull();
  });
});
