import type { FlowNode, NodeNotes, Suggestion } from "@8n8/model";
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
import { fetchNotes, fetchSuggestions, fetchSummary } from "../../api";
import { DetailPanel } from "../DetailPanel";

vi.mock("../../api", () => ({
  fetchSummary: vi.fn(),
  fetchSuggestions: vi.fn(),
  fetchNotes: vi.fn(),
}));
const notesMock = vi.mocked(fetchNotes);
const suggestMock = vi.mocked(fetchSuggestions);
const fetchMock = vi.mocked(fetchSummary);

// The tabs stay in the DOM, hidden: here the tests read them all, and open the tab they mean.
beforeAll(() => configure({ defaultHidden: true }));
afterAll(() => configure({ defaultHidden: false }));
afterEach(cleanup);

const source = "def f(peso):\n    x = 1\n    return x\n";
const node: FlowNode = {
  id: "fn:f",
  kind: "function",
  label: "f",
  parentId: null,
  range: { start: 1, end: 3 },
  openable: true,
};
const generated: Suggestion = {
  id: "g1",
  command: "Valide o peso",
  reason: "Peso negativo gera erro.",
  line: 1,
  severity: "alta",
  lines: [1],
};
const kept: Suggestion = {
  id: "chat-1",
  origin: "chat",
  command: "Dê nome ao valor 1",
  reason: "O número não diz o que é.",
  line: 2,
  severity: "baixa",
  lines: [2],
};
const none: NodeNotes = { saved: [], dismissed: [] };

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ status: "not-cached" });
  suggestMock.mockReset().mockResolvedValue({
    status: "ok",
    result: [generated],
    fromCache: false,
    review: "full",
  });
  notesMock.mockReset().mockResolvedValue(none);
});

function show(onSuggestions = vi.fn()) {
  render(
    <DetailPanel
      source={source}
      origin={{ source }}
      node={node}
      effects={[]}
      auto={{ summary: false, suggestions: true }}
      onSuggestions={onSuggestions}
    />,
  );
  return onSuggestions;
}

const tab = () =>
  fireEvent.click(screen.getByRole("tab", { name: /^Sugestões/ }));
const list = () => document.querySelector("#panel-suggestions") as HTMLElement;
const removeButtons = () =>
  within(list()).getAllByRole("button", { name: "Remover sugestão" });

describe("DetailPanel, the suggestions kept from the chat", () => {
  it("reads the notes of the node when it opens", async () => {
    show();
    await waitFor(() =>
      expect(notesMock).toHaveBeenCalledWith({ source }, "fn:f", {
        action: "get",
      }),
    );
  });

  it("shows what the chat kept under its own title, and counts it on the tab", async () => {
    notesMock.mockResolvedValue({ saved: [kept], dismissed: [] });
    show();
    tab();
    expect(await screen.findByText("Dê nome ao valor 1 (linha 2, baixa)"));
    expect(within(list()).getByText("Da conversa")).toBeTruthy();
    expect(
      within(list()).getByText("Valide o peso (linha 1, alta)"),
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: /^Sugestões/ }).textContent,
    ).toContain("2");
  });

  it("gives the map the generated and the kept ones together", async () => {
    notesMock.mockResolvedValue({ saved: [kept], dismissed: [] });
    const onSuggestions = show();
    await waitFor(() =>
      expect(onSuggestions).toHaveBeenLastCalledWith("fn:f", [generated, kept]),
    );
  });

  it("shows a kept suggestion even when nothing was generated", async () => {
    suggestMock.mockResolvedValue({ status: "not-cached" });
    notesMock.mockResolvedValue({ saved: [kept], dismissed: [] });
    const onSuggestions = show();
    await waitFor(() =>
      expect(onSuggestions).toHaveBeenCalledWith("fn:f", [kept]),
    );
    tab();
    expect(await screen.findByText("Dê nome ao valor 1 (linha 2, baixa)"));
    expect(
      screen.getByRole("button", { name: "Pedir sugestões" }),
    ).toBeTruthy();
  });

  it("hides a generated suggestion the person removed before", async () => {
    notesMock.mockResolvedValue({
      saved: [],
      dismissed: ["valide o peso\npeso negativo gera erro."],
    });
    const onSuggestions = show();
    await waitFor(() =>
      expect(onSuggestions).toHaveBeenLastCalledWith("fn:f", []),
    );
    tab();
    expect(screen.queryByText("Valide o peso (linha 1, alta)")).toBeNull();
  });

  it("removes a generated suggestion: the server remembers it, and the card and the badge lose it", async () => {
    const onSuggestions = show();
    tab();
    await screen.findByText("Valide o peso (linha 1, alta)");
    notesMock.mockResolvedValue({
      saved: [],
      dismissed: ["valide o peso\npeso negativo gera erro."],
    });
    fireEvent.click(removeButtons()[0] as HTMLElement);
    await waitFor(() =>
      expect(notesMock).toHaveBeenCalledWith({ source }, "fn:f", {
        action: "dismiss",
        command: "Valide o peso",
        reason: "Peso negativo gera erro.",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Valide o peso (linha 1, alta)")).toBeNull(),
    );
    expect(onSuggestions).toHaveBeenLastCalledWith("fn:f", []);
  });

  it("removes a kept suggestion by its id", async () => {
    notesMock.mockResolvedValue({ saved: [kept], dismissed: [] });
    const onSuggestions = show();
    tab();
    await screen.findByText("Dê nome ao valor 1 (linha 2, baixa)");
    notesMock.mockResolvedValue(none);
    const buttons = removeButtons();
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    await waitFor(() =>
      expect(notesMock).toHaveBeenCalledWith({ source }, "fn:f", {
        action: "unsave",
        id: "chat-1",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Dê nome ao valor 1 (linha 2, baixa)"),
      ).toBeNull(),
    );
    expect(onSuggestions).toHaveBeenLastCalledWith("fn:f", [generated]);
  });

  it("keeps what it had when the server cannot answer", async () => {
    notesMock.mockResolvedValue({ saved: [kept], dismissed: [] });
    show();
    tab();
    await screen.findByText("Dê nome ao valor 1 (linha 2, baixa)");
    notesMock.mockResolvedValue(null);
    const buttons = removeButtons();
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    await waitFor(() => expect(notesMock).toHaveBeenCalledTimes(2));
    expect(
      screen.getByText("Dê nome ao valor 1 (linha 2, baixa)"),
    ).toBeTruthy();
  });
});
