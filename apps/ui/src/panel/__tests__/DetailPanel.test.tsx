import type { ExternalEffect, FlowNode, Suggestion, Summary } from "@8n8/model";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  fetchNotes,
  fetchSuggestions,
  fetchSummary,
  type SuggestionsResult,
  type SummaryResult,
} from "../../api";
import { lojaGraph } from "../../flow/__tests__/loja-graph";
import { DetailPanel } from "../DetailPanel";

vi.mock("../../api", () => ({
  fetchSummary: vi.fn(),
  fetchSuggestions: vi.fn(),
  fetchNotes: vi.fn(),
}));
const notesMock = vi.mocked(fetchNotes);
const fetchMock = vi.mocked(fetchSummary);
const suggestMock = vi.mocked(fetchSuggestions);

/** Both parts asked as soon as the node is selected: the behaviour before CFG-06. */
const AUTO = { summary: true, suggestions: true };
afterEach(cleanup);
// The parts live in tabs and the others stay in the DOM, hidden: these tests read the content, the tab tests below read what shows.
beforeAll(() => configure({ defaultHidden: true }));
afterAll(() => configure({ defaultHidden: false }));

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

const explanation: Summary = {
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
};
const suggestionList: Suggestion[] = [
  {
    id: "g1",
    command: "Defina um timeout na chamada HTTP",
    reason: "A chamada pode travar.",
    line: 5,
    severity: "alta",
    lines: [5],
  },
];
const ok: SummaryResult = {
  status: "ok",
  result: explanation,
  fromCache: false,
  review: "full",
};
const suggestionsOk: SuggestionsResult = {
  status: "ok",
  result: suggestionList,
  fromCache: false,
  review: "full",
};

beforeEach(() => {
  fetchMock.mockReset();
  suggestMock.mockReset();
  suggestMock.mockResolvedValue(suggestionsOk);
  notesMock.mockReset();
  notesMock.mockResolvedValue({ saved: [], dismissed: [] });
});

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

/** The text of the IO claims of one side, without their evidence buttons (VID-30). */
function ioTexts(container: HTMLElement, side: "inputs" | "outputs") {
  const io = container.querySelector(".io");
  if (!io) throw new Error("no .io");
  const arrow = io.querySelector(".arrow");
  return [...io.querySelectorAll("[data-claim-id]")]
    .filter((el) => {
      const after =
        arrow !== null &&
        (arrow.compareDocumentPosition(el) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
          0;
      return side === "outputs" ? after : !after;
    })
    .map((el) => el.firstChild?.textContent);
}

/** The IO line as read, without the evidence buttons (VID-30). */
function ioLine(container: HTMLElement): string {
  const io = container.querySelector(".io")?.cloneNode(true) as HTMLElement;
  for (const b of io.querySelectorAll("button")) b.remove();
  return io.textContent ?? "";
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
  it("names a snippet 'trecho' with no extension when it gets no file name", () => {
    fetchMock.mockResolvedValue({ status: "no-key" });
    render(
      <DetailPanel
        source={source}
        origin={{ source }}
        node={httpNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "CÓDIGO · trecho, linha 5" }),
    ).toBeTruthy();
  });

  it("shows a project node's own file path, not the snippet name", () => {
    fetchMock.mockResolvedValue({ status: "no-key" });
    render(
      <DetailPanel
        source={source}
        origin={{ root: "C:/loja" }}
        filePath="src/frete.ts"
        snippetFile="trecho.py"
        node={httpNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "CÓDIGO · src/frete.ts, linha 5" }),
    ).toBeTruthy();
  });

  it("shows the failure and a retry button instead of loading when the file failed; the button calls onRetry", () => {
    fetchMock.mockResolvedValue({ status: "no-key" });
    const onRetry = vi.fn();
    render(
      <DetailPanel
        origin={{ root: "C:/loja" }}
        filePath="src/frete.ts"
        node={httpNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByText("Carregando o código…")).toBeNull();
    expect(
      screen.getByText("Não foi possível carregar o arquivo."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says Claude Code was not found when the provider is claude-code and it is missing (CC-17)", async () => {
    fetchMock.mockResolvedValue({ status: "no-key" });
    render(
      <DetailPanel
        source={source}
        origin={{ source }}
        snippetFile="trecho.py"
        node={httpNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
        onOpenSettings={() => {}}
        claudeMissing
      />,
    );
    expect(
      await screen.findByText(
        "O Claude Code não foi encontrado. Escolha o executável em Configurações.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText("Configure um provedor de LLM em Configurações."),
    ).toBeNull();
  });

  it("shows the code heading and exact code of an external node and asks for its summary (CORE-14, VID-28)", async () => {
    fetchMock.mockResolvedValue({ status: "no-key" });
    const { container } = render(
      <DetailPanel
        source={source}
        origin={{ source }}
        snippetFile="trecho.py"
        node={httpNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "CÓDIGO · trecho.py, linha 5" }),
    ).toBeTruthy();
    expect(codeLines(container)).toEqual([
      '    requests.get("https://api.exemplo.com/tabela-frete")',
    ]);
    expect(
      await screen.findByText("Configure um provedor de LLM em Configurações."),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      { source },
      "fn:calcular_frete/s0",
      false,
    );
  });

  it("fetches once for a function and shows summary, inputs, outputs and suggestions (CORE-16)", async () => {
    fetchMock.mockResolvedValue(ok);
    const { container } = render(
      <DetailPanel
        source={source}
        origin={{ source }}
        node={fnNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
      />,
    );
    expect(
      itemTexts(await screen.findByRole("list", { name: "Resumo" })),
    ).toEqual([
      "Calcula o frete pelo peso e pela distância.",
      "Dobra a taxa acima de 30.",
    ]);
    expect(ioTexts(container, "inputs")).toEqual(["peso", "distancia"]);
    expect(ioTexts(container, "outputs")).toEqual(["valor do frete"]);
    expect(
      screen.getByText("Defina um timeout na chamada HTTP (linha 5, alta)"),
    ).toBeTruthy();
    expect(screen.getByText("A chamada pode travar.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      { source },
      "fn:calcular_frete",
      false,
    );
  });

  it("shows the no-key message and keeps the code visible (CORE-19)", async () => {
    fetchMock.mockResolvedValue({ status: "no-key" });
    const { container } = render(
      <DetailPanel
        source={source}
        origin={{ source }}
        node={fnNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
      />,
    );
    expect(
      await screen.findByText("Configure um provedor de LLM em Configurações."),
    ).toBeTruthy();
    expect(codeLines(container)).toHaveLength(8);
    expect(codeLines(container)[0]).toBe(
      "def calcular_frete(peso, distancia):",
    );
  });

  it("shows Resumo indisponível with the Gerar resumo button, and retrying shows the summary (CORE-20)", async () => {
    fetchMock
      .mockResolvedValueOnce({ status: "error", message: "HTTP 502" })
      .mockResolvedValueOnce(ok);
    render(
      <DetailPanel
        source={source}
        origin={{ source }}
        node={fnNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
      />,
    );
    expect(await screen.findByText("Resumo indisponível")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Gerar resumo" }));
    // The button runs the shortcut in the chat: the summary shows there and in its tab.
    expect(
      await screen.findAllByText("Calcula o frete pelo peso e pela distância."),
    ).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Resumo indisponível")).toBeNull();
  });

  it("marks the suggestion's line in the code view on click (CORE-24)", async () => {
    fetchMock.mockResolvedValue(ok);
    const { container } = render(
      <DetailPanel
        source={source}
        origin={{ source }}
        node={fnNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
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
        origin={{ source }}
        node={fnNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
      />,
    );
    expect(
      await screen.findByText(
        'O trecho mudou. Clique em "Gerar mapa" de novo.',
      ),
    ).toBeTruthy();
  });

  it("calls onSuggestions with the node ID and the suggestions on ok (CFG-10)", async () => {
    fetchMock.mockResolvedValue(ok);
    const onSuggestions = vi.fn();
    render(
      <DetailPanel
        source={source}
        origin={{ source }}
        node={fnNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={onSuggestions}
      />,
    );
    await waitFor(() =>
      expect(onSuggestions).toHaveBeenCalledWith(
        "fn:calcular_frete",
        suggestionList,
      ),
    );
  });

  it.each([
    ["full", "Revisado"],
    ["cut", "Revisado com cortes"],
  ] as const)(
    "shows the review badge for review %s (FID-09, FID-11)",
    async (review, badge) => {
      fetchMock.mockResolvedValue({ ...ok, review } as SummaryResult);
      const { container } = render(
        <DetailPanel
          source={source}
          origin={{ source }}
          node={fnNode}
          effects={[]}
          auto={AUTO}
          onSuggestions={() => {}}
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
        origin={{ source }}
        node={fnNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
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
      } as SummaryResult);
      render(
        <DetailPanel
          source={source}
          origin={{ source }}
          node={fnNode}
          effects={[]}
          auto={AUTO}
          onSuggestions={() => {}}
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
        origin={{ source }}
        node={fnNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
      />,
    );
    await screen.findByRole("list", { name: "Resumo" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the unfaithful message with the Gerar resumo button, which fetches again (FID-10)", async () => {
    fetchMock
      .mockResolvedValueOnce({ status: "unfaithful" })
      .mockResolvedValueOnce(ok);
    render(
      <DetailPanel
        source={source}
        origin={{ source }}
        node={fnNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
      />,
    );
    expect(
      await screen.findByText("Não foi possível gerar um resumo fiel."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Gerar resumo" }));
    expect(
      (await screen.findAllByRole("list", { name: "Resumo" })).length,
    ).toBeGreaterThan(0);
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
        origin={{ source }}
        node={fnNode}
        effects={[requestsGet]}
        auto={AUTO}
        onSuggestions={() => {}}
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
        origin={{ source }}
        node={fnNode}
        effects={[requestsGet]}
        auto={AUTO}
        onSuggestions={() => {}}
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
        origin={{ source }}
        node={fnNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
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
      "Configure um provedor de LLM em Configurações.",
    ],
    ["error", { status: "error", message: "HTTP 502" }, "Resumo indisponível"],
  ] as const)(
    "lists the effects when the explanation is %s (FID-14)",
    async (_state, result, message) => {
      fetchMock.mockResolvedValue(result as SummaryResult);
      render(
        <DetailPanel
          source={source}
          origin={{ source }}
          node={fnNode}
          effects={[requestsGet]}
          auto={AUTO}
          onSuggestions={() => {}}
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
    let answer: (r: SummaryResult) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    render(
      <DetailPanel
        source={source}
        origin={{ source }}
        node={fnNode}
        effects={[requestsGet]}
        auto={AUTO}
        onSuggestions={() => {}}
      />,
    );
    expect(screen.getByText("Gerando resumo…")).toBeTruthy();
    expect(
      within(screen.getByRole("list", { name: "Efeitos externos" })).getByText(
        "requests.get (HTTP, linha 5)",
      ),
    ).toBeTruthy();
    answer({ status: "no-key" });
    await screen.findByText("Configure um provedor de LLM em Configurações.");
  });

  it("shows no effects section for an external node (FID-14)", () => {
    fetchMock.mockResolvedValue({ status: "no-key" });
    render(
      <DetailPanel
        source={source}
        origin={{ source }}
        node={httpNode}
        effects={[requestsGet]}
        auto={AUTO}
        onSuggestions={() => {}}
      />,
    );
    expect(screen.queryByText("Efeitos externos")).toBeNull();
    expect(screen.queryByText("Nenhum efeito externo.")).toBeNull();
  });
});

describe("DetailPanel like the video (VID-28, VID-29, VID-30, VID-33)", () => {
  const stepExplanation: Summary = {
    summary:
      "A função consulta uma API externa com o CEP. A função retorna a UF.",
    sentences: [
      {
        id: "s1",
        text: "A função consulta uma API externa com o CEP.",
        lines: [5],
      },
      { id: "s2", text: "A função retorna a UF.", lines: [5] },
    ],
    inputs: [{ id: "i1", text: "`cep`", lines: [5] }],
    outputs: [{ id: "o1", text: "`uf`", lines: [5] }],
  };
  const stepOk: SummaryResult = {
    status: "ok",
    result: stepExplanation,
    fromCache: false,
    review: "full",
  };

  function renderStep(result: SummaryResult, node: FlowNode = httpNode) {
    fetchMock.mockResolvedValue(result);
    return render(
      <DetailPanel
        source={source}
        origin={{ source }}
        node={node}
        title="Buscar UF pelo CEP"
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
      />,
    );
  }

  it("orders a step's panel: title, code, eyebrow, badge, summary, rules, input and output", async () => {
    const { container } = renderStep(stepOk);
    await screen.findByRole("list", { name: "Resumo" });
    const aside = screen.getByRole("complementary", { name: "Detalhe do nó" });
    const parts = [
      screen.getByRole("heading", { level: 2, name: "Buscar UF pelo CEP" }),
      screen.getByRole("heading", { name: "CÓDIGO · trecho, linha 5" }),
      container.querySelector("pre"),
      screen.getByText("O QUE FAZ · PORTUGUÊS TÉCNICO SIMPLIFICADO"),
      screen.getByText("Revisado"),
      screen.getByRole("list", { name: "Resumo" }),
      screen.getByText("2 frases · voz ativa · um termo por conceito"),
      screen.getByRole("heading", { name: "ENTRADA E SAÍDA" }),
      screen.getByLabelText("Entrada e saída"),
    ];
    const order = [...aside.querySelectorAll("*")];
    const positions = parts.map((el) => order.indexOf(el as Element));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(
      screen.getByText("O QUE FAZ · PORTUGUÊS TÉCNICO SIMPLIFICADO").className,
    ).toBe("eyebrow");
    expect(
      screen.getByText("2 frases · voz ativa · um termo por conceito")
        .className,
    ).toBe("rules");
  });

  it("shows cep → uf without backticks and keeps each item's evidence button", async () => {
    const { container } = renderStep(stepOk);
    await screen.findByLabelText("Entrada e saída");
    expect(ioLine(container)).toBe("cep → uf");
    expect(container.querySelector(".io .arrow")?.textContent).toBe("→");
    fireEvent.click(
      within(claimItem(container, "o1")).getByRole("button", { name: "L5" }),
    );
    expect(marked(container)).toEqual(["5"]);
  });

  it("leaves out ENTRADA E SAÍDA when there are no inputs nor outputs", async () => {
    renderStep({
      ...stepOk,
      result: { ...stepExplanation, inputs: [], outputs: [] },
    } as SummaryResult);
    await screen.findByRole("list", { name: "Resumo" });
    expect(screen.queryByText("ENTRADA E SAÍDA")).toBeNull();
    expect(screen.queryByLabelText("Entrada e saída")).toBeNull();
  });

  it("shows a function without the rules line, with DISCO and E-MAIL effects and the suggestions", async () => {
    fetchMock.mockResolvedValue(ok);
    render(
      <DetailPanel
        source={source}
        origin={{ source }}
        node={fnNode}
        effects={[
          { callee: "open", category: "ARQUIVO", line: 6 },
          { callee: "enviar_email", category: "EMAIL", line: 7 },
        ]}
        auto={AUTO}
        onSuggestions={() => {}}
      />,
    );
    await screen.findByRole("list", { name: "Resumo" });
    expect(
      screen.queryByText("2 frases · voz ativa · um termo por conceito"),
    ).toBeNull();
    expect(
      screen.getByRole("heading", {
        name: "CÓDIGO · trecho, linhas 4 a 11",
      }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("list", { name: "Efeitos externos" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["open (DISCO, linha 6)", "enviar_email (E-MAIL, linha 7)"]);
    expect(screen.getByRole("tab", { name: /^Sugestões/ })).toBeTruthy();
  });

  it("shows the provisional name without a title (VID-15)", () => {
    fetchMock.mockResolvedValue({ status: "no-key" });
    render(
      <DetailPanel
        source={source}
        origin={{ source }}
        node={fnNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Calcular frete" }),
    ).toBeTruthy();
  });

  it("marks the line of mark, and marks it again with a new nonce", async () => {
    fetchMock.mockResolvedValue(ok);
    const props = {
      source,
      origin: { source },
      node: fnNode,
      effects: [],
      auto: AUTO,
      onSuggestions: () => {},
    };
    const { container, rerender } = render(
      <DetailPanel {...props} mark={{ line: 5, nonce: 1 }} />,
    );
    await screen.findByRole("list", { name: "Resumo" });
    expect(marked(container)).toEqual(["5"]);
    fireEvent.click(
      within(claimItem(container, "s1")).getByRole("button", { name: "L4" }),
    );
    expect(marked(container)).toEqual(["4"]);
    rerender(<DetailPanel {...props} mark={{ line: 5, nonce: 2 }} />);
    expect(marked(container)).toEqual(["5"]);
  });
});

describe("DetailPanel in a project (PROJ-02, PROJ-04, AD-015)", () => {
  const root = "C:\\tmp\\loja";
  const calculo = [
    "def calcular_frete(peso):",
    "    if peso > 30:",
    "        return 50",
    "    return 20",
  ].join("\n");
  const node = (id: string) => {
    const n = lojaGraph.nodes.find((x) => x.id === id);
    if (!n) throw new Error(`no node ${id}`);
    return n;
  };

  it("shows every line of the file for a file node, and the buttons to explain it", async () => {
    fetchMock.mockResolvedValue({ status: "not-cached" });
    suggestMock.mockResolvedValue({ status: "not-cached" });
    const { container } = render(
      <DetailPanel
        source={calculo}
        origin={{ root }}
        filePath="frete/calculo.py"
        node={node("file:frete/calculo.py")}
        effects={[]}
        auto={{ summary: false, suggestions: false }}
        onSuggestions={() => {}}
      />,
    );
    expect(codeLines(container)).toEqual([
      "def calcular_frete(peso):",
      "    if peso > 30:",
      "        return 50",
      "    return 20",
    ]);
    // Nothing is generated on opening: only the cache is asked, and the buttons wait for a click.
    await screen.findByRole("button", { name: "Gerar resumo" });
    expect(
      screen.getByRole("button", { name: "Pedir sugestões" }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      { root },
      "file:frete/calculo.py",
      true,
    );
  });

  it("names the file and the lines of a project function above its code and explains it by root", async () => {
    fetchMock.mockResolvedValue({ status: "no-key" });
    const { container } = render(
      <DetailPanel
        source={calculo}
        origin={{ root }}
        filePath="frete/calculo.py"
        node={node("file:frete/calculo.py/fn:calcular_frete")}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
      />,
    );
    expect(
      await screen.findByText("Configure um provedor de LLM em Configurações."),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "CÓDIGO · frete/calculo.py, linhas 1 a 4",
      }),
    ).toBeTruthy();
    expect(codeLines(container)[0]).toBe("def calcular_frete(peso):");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      { root },
      "file:frete/calculo.py/fn:calcular_frete",
      false,
    );
  });
});

describe("DetailPanel on demand (CFG-06..11)", () => {
  const panel = (extra: Record<string, unknown> = {}) => (
    <DetailPanel
      source={source}
      origin={{ source }}
      node={fnNode}
      effects={[]}
      onSuggestions={() => {}}
      {...extra}
    />
  );

  it("asks only the cache for both parts, and shows a button for each miss (CFG-05, CFG-06)", async () => {
    fetchMock.mockResolvedValue({ status: "not-cached" });
    suggestMock.mockResolvedValue({ status: "not-cached" });
    render(panel());
    expect(
      await screen.findByRole("button", { name: "Gerar resumo" }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "Pedir sugestões" }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      { source },
      "fn:calcular_frete",
      true,
    );
    expect(suggestMock).toHaveBeenCalledWith(
      { source },
      "fn:calcular_frete",
      true,
    );
    expect(screen.queryByText("Gerando resumo…")).toBeNull();
  });

  it("shows both buttons at once, before the cache answers, and a late hit replaces the button (CFG-06)", async () => {
    let answer: (r: SummaryResult) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    suggestMock.mockReturnValue(new Promise(() => {}));
    render(panel());
    expect(screen.getByRole("button", { name: "Gerar resumo" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Pedir sugestões" }),
    ).toBeTruthy();
    answer({ ...ok, fromCache: true } as SummaryResult);
    expect(await screen.findByRole("list", { name: "Resumo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Gerar resumo" })).toBeNull();
  });

  it("shows a cache hit with no click (CFG-06)", async () => {
    fetchMock.mockResolvedValue({ ...ok, fromCache: true } as SummaryResult);
    suggestMock.mockResolvedValue({
      ...suggestionsOk,
      fromCache: true,
    } as SuggestionsResult);
    render(panel());
    expect(await screen.findByRole("list", { name: "Resumo" })).toBeTruthy();
    expect(
      await screen.findByText(
        "Defina um timeout na chamada HTTP (linha 5, alta)",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Gerar resumo" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(suggestMock).toHaveBeenCalledTimes(1);
  });

  it("Gerar resumo asks the summary for real, shows Gerando resumo… and leaves the suggestions alone (CFG-07)", async () => {
    let answer: (r: SummaryResult) => void = () => {};
    fetchMock
      .mockResolvedValueOnce({ status: "not-cached" })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
    suggestMock.mockResolvedValue({ status: "not-cached" });
    render(panel());
    fireEvent.click(
      await screen.findByRole("button", { name: "Gerar resumo" }),
    );
    // The button runs the shortcut in the chat: the loading shows there and in the tab.
    expect(await screen.findAllByText("Gerando resumo…")).toHaveLength(2);
    expect(
      screen.getByRole("tab", { name: "Conversa", selected: true }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      { source },
      "fn:calcular_frete",
      false,
    );
    answer(ok);
    expect(await screen.findAllByRole("list", { name: "Resumo" })).toHaveLength(
      2,
    );
    expect(suggestMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Pedir sugestões" }),
    ).toBeTruthy();
  });

  it("Pedir sugestões asks the suggestions for real and shows them (CFG-07)", async () => {
    fetchMock.mockResolvedValue({ status: "not-cached" });
    let answer: (r: SuggestionsResult) => void = () => {};
    suggestMock
      .mockResolvedValueOnce({ status: "not-cached" })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
    const onSuggestions = vi.fn();
    render(panel({ onSuggestions }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Pedir sugestões" }),
    );
    expect(await screen.findAllByText("Pedindo sugestões…")).toHaveLength(2);
    answer(suggestionsOk);
    expect(
      await screen.findAllByText(
        "Defina um timeout na chamada HTTP (linha 5, alta)",
      ),
    ).toHaveLength(2);
    expect(suggestMock).toHaveBeenLastCalledWith(
      { source },
      "fn:calcular_frete",
      false,
    );
    expect(onSuggestions).toHaveBeenCalledWith(
      "fn:calcular_frete",
      suggestionList,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks only the automatic part for real (CFG-08)", async () => {
    fetchMock.mockResolvedValue(ok);
    suggestMock.mockResolvedValue({ status: "not-cached" });
    render(panel({ auto: { summary: true, suggestions: false } }));
    await screen.findByRole("list", { name: "Resumo" });
    expect(fetchMock).toHaveBeenCalledWith(
      { source },
      "fn:calcular_frete",
      false,
    );
    expect(suggestMock).toHaveBeenCalledWith(
      { source },
      "fn:calcular_frete",
      true,
    );
    expect(
      await screen.findByRole("button", { name: "Pedir sugestões" }),
    ).toBeTruthy();
  });

  it("without a provider says so in both parts, with a button that opens the settings (CFG-09)", async () => {
    fetchMock.mockResolvedValue({ status: "no-key" });
    suggestMock.mockResolvedValue({ status: "no-key" });
    const onOpenSettings = vi.fn();
    render(panel({ auto: AUTO, onOpenSettings }));
    await waitFor(() =>
      expect(
        screen.getAllByText("Configure um provedor de LLM em Configurações."),
      ).toHaveLength(2),
    );
    const buttons = screen.getAllByRole("button", {
      name: "Abrir configurações",
    });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0] as HTMLElement);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("says Nenhuma sugestão para este nó. for an empty list, and calls onSuggestions with it (CFG-10, CFG-11)", async () => {
    fetchMock.mockResolvedValue(ok);
    suggestMock.mockResolvedValue({ ...suggestionsOk, result: [] });
    const onSuggestions = vi.fn();
    render(panel({ auto: AUTO, onSuggestions }));
    expect(
      await screen.findByText("Nenhuma sugestão para este nó."),
    ).toBeTruthy();
    expect(onSuggestions).toHaveBeenCalledWith("fn:calcular_frete", []);
  });

  it("shows Sugestões indisponíveis with a retry for a failed suggestions request", async () => {
    fetchMock.mockResolvedValue(ok);
    suggestMock
      .mockResolvedValueOnce({ status: "error", message: "HTTP 502" })
      .mockResolvedValueOnce(suggestionsOk);
    render(panel({ auto: AUTO }));
    expect(await screen.findByText("Sugestões indisponíveis")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pedir sugestões" }));
    expect(
      (
        await screen.findAllByText(
          "Defina um timeout na chamada HTTP (linha 5, alta)",
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(suggestMock).toHaveBeenCalledTimes(2);
  });

  it("keeps one button for the summary: disabled while it loads, the same one enabled again after a failure", async () => {
    let fail: (r: SummaryResult) => void = () => {};
    fetchMock
      .mockResolvedValueOnce({ status: "not-cached" })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          fail = resolve;
        }),
      );
    suggestMock.mockResolvedValue({ status: "not-cached" });
    render(panel());
    fireEvent.click(
      await screen.findByRole("button", { name: "Gerar resumo" }),
    );
    const busy = await screen.findAllByRole("button", {
      name: "Gerando resumo…",
    });
    expect(busy.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    fail({ status: "error", message: "caiu" });
    expect((await screen.findAllByText("Resumo indisponível")).length).toBe(2);
    const again = screen.getAllByRole("button", { name: "Gerar resumo" });
    expect(again.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });

  it("a click on one node never asks for real on the next one", async () => {
    fetchMock.mockResolvedValue({ status: "not-cached" });
    suggestMock.mockResolvedValue({ status: "not-cached" });
    const { rerender } = render(panel());
    fireEvent.click(
      await screen.findByRole("button", { name: "Gerar resumo" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    rerender(panel({ node: httpNode }));
    await screen.findByRole("button", { name: "Gerar resumo" });
    expect(fetchMock).toHaveBeenLastCalledWith(
      { source },
      "fn:calcular_frete/s0",
      true,
    );
  });
});

describe("DetailPanel tabs", () => {
  // Here the hidden panels stay hidden, as for the user.
  beforeAll(() => configure({ defaultHidden: false }));
  afterAll(() => configure({ defaultHidden: true }));

  const renderFn = () => {
    fetchMock.mockResolvedValue({ status: "no-key" });
    suggestMock.mockResolvedValue({ status: "no-key" });
    render(
      <DetailPanel
        source={source}
        origin={{ source }}
        node={fnNode}
        effects={[]}
        auto={AUTO}
        onSuggestions={() => {}}
      />,
    );
  };

  it("starts on the code and shows one part at a time", async () => {
    renderFn();
    const code = screen.getByRole("tab", { name: "Código" });
    expect(code.getAttribute("aria-selected")).toBe("true");
    expect(
      screen.queryByRole("heading", { name: "Efeitos externos" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Resumo" }));
    expect(screen.queryByRole("heading", { name: /^CÓDIGO/ })).toBeNull();
    expect(code.getAttribute("aria-selected")).toBe("false");
  });

  it("keeps the tab when another node opens, so summaries can be read one after the other", () => {
    fetchMock.mockResolvedValue({ status: "no-key" });
    suggestMock.mockResolvedValue({ status: "no-key" });
    const props = {
      source,
      origin: { source },
      effects: [],
      auto: AUTO,
      onSuggestions: () => {},
    };
    const { rerender } = render(<DetailPanel {...props} node={fnNode} />);
    fireEvent.click(screen.getByRole("tab", { name: "Resumo" }));
    rerender(<DetailPanel {...props} node={{ ...fnNode, id: "fn:outra" }} />);
    expect(
      screen.getByRole("tab", { name: "Resumo" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("moves between the tabs with the arrow keys", () => {
    renderFn();
    const code = screen.getByRole("tab", { name: "Código" });
    fireEvent.keyDown(code, { key: "ArrowRight" });
    expect(
      screen
        .getByRole("tab", { name: "Conversa" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Conversa" }), {
      key: "ArrowLeft",
    });
    expect(code.getAttribute("aria-selected")).toBe("true");
  });
});
