import { CHAT_MAX_CHARS, type ChatRequest, type LlmClient } from "@8n8/model";
import { describe, expect, it, vi } from "vitest";
import { chatNode, clampReply } from "../chat";
import { buildChatPrompt, chatContextText } from "../chat-prompt";

const lang = { label: "Python", commentPrefix: "#" };
const parent = {
  name: "calcular_frete",
  kind: "function" as const,
  code: "def calcular_frete(peso):\n    base = 10\n    return base",
  range: { start: 4, end: 6 },
};
const req: ChatRequest = {
  language: "python",
  nodeName: "se peso > 30",
  nodeKind: "condition",
  code: "if peso > 30:\n    taxa = 2",
  range: { start: 8, end: 9 },
  parent,
  calls: [],
  calledBy: ["processar_pedido"],
  history: [{ role: "user", content: "Oi" }],
  question: "Por que 30?",
};

describe("buildChatPrompt", () => {
  it("asks for the limit, the node and parent only, and carries the rules", () => {
    const { text, version } = buildChatPrompt("REGRAS PTS", lang, "pt-BR");
    expect(text).toContain(`no máximo ${CHAT_MAX_CHARS} caracteres`);
    expect(text).toContain("só sobre esse código");
    expect(text).toContain("REGRAS PTS");
    expect(version).toMatch(/^[0-9a-f]{12}$/);
  });

  it("speaks English with the English rules", () => {
    const { text } = buildChatPrompt("RULES STE", lang, "en");
    expect(text).toContain(`at most ${CHAT_MAX_CHARS} characters`);
    expect(text).toContain("RULES STE");
    expect(text).not.toContain("caracteres");
  });

  it("changes the version when the rules change", () => {
    expect(buildChatPrompt("a", lang).version).not.toBe(
      buildChatPrompt("b", lang).version,
    );
  });
});

describe("chatContextText", () => {
  it("numbers the node and its parent with their real lines", () => {
    const text = chatContextText(req, "pt-BR");
    expect(text).toContain("8 | if peso > 30:");
    expect(text).toContain("9 |     taxa = 2");
    expect(text).toContain("4 | def calcular_frete(peso):");
    expect(text).toContain("Pai (inteiro): calcular_frete (função)");
    expect(text).toContain("Chamado por: processar_pedido");
  });

  it("leaves the parent out when there is none", () => {
    const { parent: _, ...alone } = req;
    expect(chatContextText(alone, "pt-BR")).not.toContain("Pai");
  });

  it("cuts a huge parent", () => {
    const big = {
      ...req,
      parent: { ...parent, code: "x = 1\n".repeat(5000) },
    };
    expect(chatContextText(big, "pt-BR").length).toBeLessThan(20000);
  });
});

describe("chatNode", () => {
  const prompt = { text: "PROMPT", version: "v" };

  it("sends the prompt with the context, the past and the question, in that order", async () => {
    const complete = vi.fn().mockResolvedValue("  Porque sim.  ");
    const llm: LlmClient = { complete };
    const res = await chatNode(req, { llm, model: "m", prompt });
    expect(res).toEqual({ status: "ok", reply: "Porque sim." });
    const call = complete.mock.calls[0]?.[0];
    const messages = call.messages;
    expect(call.model).toBe("m");
    expect(messages.map((m: { role: string }) => m.role)).toEqual([
      "system",
      "user",
      "user",
    ]);
    expect(messages[0].content).toContain("PROMPT");
    expect(messages[0].content).toContain("8 | if peso > 30:");
    expect(messages[2].content).toBe("Por que 30?");
  });

  it("answers no-key without a client", async () => {
    expect(await chatNode(req, { model: "m", prompt })).toEqual({
      status: "no-key",
    });
  });

  it("turns a failure into an error answer", async () => {
    const llm: LlmClient = {
      complete: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const res = await chatNode(req, { llm, model: "m", prompt });
    expect(res.status).toBe("error");
  });
});

describe("clampReply", () => {
  it("keeps a short answer and a little over the limit", () => {
    expect(clampReply("curta")).toBe("curta");
    const near = "a ".repeat(CHAT_MAX_CHARS / 2 + 50).trim();
    expect(clampReply(near)).toBe(near);
  });

  it("cuts a long answer at a word, with an ellipsis", () => {
    const long = "palavra ".repeat(300);
    const out = clampReply(long);
    expect(out.length).toBeLessThanOrEqual(CHAT_MAX_CHARS + 1);
    expect(out.endsWith("palavra…")).toBe(true);
  });
});
