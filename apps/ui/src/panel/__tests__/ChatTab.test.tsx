import type { FlowNode } from "@8n8/model";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatResult, fetchChat } from "../../api";
import { type ChatEntry, ChatTab, commandOf } from "../ChatTab";

vi.mock("../../api", () => ({ fetchChat: vi.fn() }));
const chatMock = vi.mocked(fetchChat);

const node: FlowNode = {
  id: "fn:f",
  kind: "function",
  label: "f",
  parentId: null,
  range: { start: 4, end: 9 },
  openable: true,
};
const origin = { source: "def f(): pass" };

function setup(
  overrides: Partial<Parameters<typeof ChatTab>[0]> = {},
  store?: Map<string, ChatEntry[]>,
) {
  const props = {
    node,
    origin,
    store,
    renderPart: (part: string) => <p>PART {part}</p>,
    askPart: vi.fn(),
    onMark: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  render(<ChatTab {...props} />);
  return props;
}

const box = () => screen.getByRole("textbox");
async function say(text: string) {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
}
const ok = (reply: string): ChatResult => ({ status: "ok", reply });

beforeEach(() => chatMock.mockReset());
afterEach(cleanup);

describe("commandOf", () => {
  it("reads the shortcuts with or without accents, in both languages", () => {
    expect(commandOf("/resumo")).toBe("summary");
    expect(commandOf(" /Summary ")).toBe("summary");
    expect(commandOf("/sugestões")).toBe("suggestions");
    expect(commandOf("/sugestoes")).toBe("suggestions");
    expect(commandOf("/suggestions")).toBe("suggestions");
    expect(commandOf("resumo")).toBeNull();
    expect(commandOf("o que é /resumo?")).toBeNull();
  });
});

describe("ChatTab", () => {
  it("starts with a hint and the two shortcuts", () => {
    setup();
    expect(
      screen.getByText("Pergunte sobre este nó e sobre o pai dele.", {
        exact: false,
      }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "/resumo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "/sugestões" })).toBeTruthy();
  });

  it("asks the question, shows the thinking bubble, then the answer", async () => {
    let answer: (r: ChatResult) => void = () => {};
    chatMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    setup();
    await say("O que faz?");
    expect(chatMock).toHaveBeenCalledWith(origin, "fn:f", [], "O que faz?");
    expect(screen.getByText("O que faz?")).toBeTruthy();
    expect(screen.getByText("Pensando…")).toBeTruthy();
    expect((box() as HTMLTextAreaElement).value).toBe("");
    answer(ok("Soma o frete."));
    expect(await screen.findByText("Soma o frete.")).toBeTruthy();
    expect(screen.queryByText("Pensando…")).toBeNull();
  });

  it("sends the text turns of the conversation as the past of the next question", async () => {
    chatMock.mockResolvedValue(ok("R1"));
    setup();
    await say("P1");
    await screen.findByText("R1");
    chatMock.mockResolvedValue(ok("R2"));
    await say("P2");
    await screen.findByText("R2");
    expect(chatMock).toHaveBeenLastCalledWith(
      origin,
      "fn:f",
      [
        { role: "user", content: "P1" },
        { role: "assistant", content: "R1" },
      ],
      "P2",
    );
  });

  it("sends with Enter and breaks the line with Shift+Enter", async () => {
    chatMock.mockResolvedValue(ok("r"));
    setup();
    fireEvent.change(box(), { target: { value: "oi" } });
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(chatMock).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(chatMock).toHaveBeenCalledTimes(1);
    await screen.findByText("r");
  });

  it("does not send an empty question", () => {
    setup();
    expect(
      (screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("turns each L-mark inside the node into a button that marks the line", async () => {
    chatMock.mockResolvedValue(ok("Veja L6 e também L99."));
    const { onMark } = setup();
    await say("onde?");
    const ref = await screen.findByRole("button", { name: "L6" });
    fireEvent.click(ref);
    expect(onMark).toHaveBeenCalledWith(new Set([6]));
    expect(screen.queryByRole("button", { name: "L99" })).toBeNull();
    expect(screen.getByText("L99", { exact: false })).toBeTruthy();
  });

  it("runs /resumo as a shortcut: asks the part, shows it in the chat, and never calls the chat", async () => {
    const { askPart } = setup();
    await say("/resumo");
    expect(askPart).toHaveBeenCalledWith("summary");
    expect(chatMock).not.toHaveBeenCalled();
    expect(screen.getByText("PART summary")).toBeTruthy();
  });

  it("runs the chip of the suggestions the same way and keeps the shortcuts after the first message", async () => {
    const { askPart } = setup();
    fireEvent.click(screen.getByRole("button", { name: "/sugestões" }));
    expect(askPart).toHaveBeenCalledWith("suggestions");
    expect(screen.getByText("PART suggestions")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "/resumo" })).toHaveLength(1);
  });

  it("does not send a shortcut as the past of the conversation", async () => {
    chatMock.mockResolvedValue(ok("R"));
    setup();
    await say("/resumo");
    await say("Por quê?");
    await screen.findByText("R");
    expect(chatMock).toHaveBeenCalledWith(origin, "fn:f", [], "Por quê?");
  });

  it("says there is no provider, with a button to the settings", async () => {
    chatMock.mockResolvedValue({ status: "no-key" });
    const { onOpenSettings } = setup();
    await say("oi");
    expect(
      await screen.findByText("Configure um provedor de LLM em Configurações."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Abrir configurações" }),
    );
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("shows a failure and asks the same question again on retry", async () => {
    chatMock.mockResolvedValueOnce({ status: "error", message: "caiu" });
    setup();
    await say("oi");
    expect(await screen.findByText("caiu")).toBeTruthy();
    chatMock.mockResolvedValueOnce(ok("voltei"));
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("voltei")).toBeTruthy();
    expect(screen.queryByText("caiu")).toBeNull();
    expect(screen.getAllByText("oi")).toHaveLength(1);
    expect(chatMock).toHaveBeenLastCalledWith(origin, "fn:f", [], "oi");
  });

  it("keeps the conversation of a node in the store, for when the tab opens again", async () => {
    chatMock.mockResolvedValue(ok("guardada"));
    const store = new Map<string, ChatEntry[]>();
    setup({}, store);
    await say("oi");
    await screen.findByText("guardada");
    cleanup();
    setup({}, store);
    expect(screen.getByText("guardada")).toBeTruthy();
    expect(screen.queryByText("Pergunte sobre este nó", { exact: false })).toBe(
      null,
    );
  });

  it("keeps an answer that arrives after the tab closed", async () => {
    let answer: (r: ChatResult) => void = () => {};
    chatMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const store = new Map<string, ChatEntry[]>();
    setup({}, store);
    await say("oi");
    cleanup();
    answer(ok("tarde"));
    await waitFor(() => expect(store.get("fn:f")?.length).toBe(2));
    setup({}, store);
    expect(screen.getByText("tarde")).toBeTruthy();
  });

  it("runs the shortcut the panel asks for, once, and only for its own node", () => {
    const askPart = vi.fn();
    const command = { part: "summary" as const, nodeId: "fn:f", nonce: 1 };
    const props = {
      node,
      origin,
      renderPart: (part: string) => <p>PART {part}</p>,
      askPart,
      onMark: vi.fn(),
    };
    const { rerender } = render(<ChatTab {...props} />);
    rerender(<ChatTab {...props} command={command} />);
    expect(askPart).toHaveBeenCalledTimes(1);
    expect(screen.getByText("PART summary")).toBeTruthy();
    rerender(<ChatTab {...props} command={command} />);
    expect(askPart).toHaveBeenCalledTimes(1);
    rerender(
      <ChatTab {...props} command={{ ...command, nodeId: "fn:g", nonce: 2 }} />,
    );
    expect(askPart).toHaveBeenCalledTimes(1);
    rerender(<ChatTab {...props} command={{ ...command, nonce: 3 }} />);
    expect(askPart).toHaveBeenCalledTimes(2);
  });
});
