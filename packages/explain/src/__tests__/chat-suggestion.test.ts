import type { ChatRequest, LlmClient, StructureRequest } from "@8n8/model";
import { describe, expect, it, vi } from "vitest";
import { chatNode, structureText } from "../chat";
import { buildChatPrompt, buildStructurePrompt } from "../chat-prompt";
import { acceptSuggestion } from "../chat-suggestion";

const range = { start: 8, end: 12 };
const lang = { label: "Python", commentPrefix: "#" };
const good = {
  command: "Defina um timeout.",
  reason: "A chamada pode travar.",
  line: 9,
  severity: "media",
};
const base = {
  language: "python",
  nodeName: "se peso > 30",
  nodeKind: "condition" as const,
  code: "a\nb\nc\nd\ne",
  range,
  calls: [],
  calledBy: [],
};
const req: ChatRequest = { ...base, history: [], question: "Algo a melhorar?" };
const sreq: StructureRequest = { ...base, text: "Defina um timeout (L9)." };
const prompt = { text: "PROMPT", version: "v" };
const llmOf = (answer: string): LlmClient => ({
  complete: vi.fn().mockResolvedValue(answer),
});

describe("acceptSuggestion", () => {
  it("keeps a whole suggestion with a line inside the node", () => {
    expect(acceptSuggestion(good, range)).toEqual(good);
  });

  it("trims the text and takes the aliases of the severity", () => {
    expect(
      acceptSuggestion(
        { ...good, command: "  Defina um timeout.  ", severity: "Medium" },
        range,
      ),
    ).toEqual(good);
  });

  it("drops a suggestion that is not whole, out of the node or too long", () => {
    expect(acceptSuggestion(null, range)).toBeUndefined();
    expect(acceptSuggestion({ ...good, command: "  " }, range)).toBeUndefined();
    expect(acceptSuggestion({ ...good, reason: "" }, range)).toBeUndefined();
    expect(acceptSuggestion({ ...good, line: 7 }, range)).toBeUndefined();
    expect(acceptSuggestion({ ...good, line: 13 }, range)).toBeUndefined();
    expect(acceptSuggestion({ ...good, line: "9" }, range)).toBeUndefined();
    expect(acceptSuggestion({ ...good, severity: "x" }, range)).toBeUndefined();
    expect(
      acceptSuggestion({ ...good, command: "a".repeat(301) }, range),
    ).toBeUndefined();
  });
});

describe("chatNode reads the JSON answer", () => {
  it("gives the reply and the suggestion the model found", async () => {
    const llm = llmOf(
      JSON.stringify({ reply: "Pode travar (L9).", suggestion: good }),
    );
    expect(await chatNode(req, { llm, model: "m", prompt })).toEqual({
      status: "ok",
      reply: "Pode travar (L9).",
      suggestion: good,
    });
  });

  it("accepts the JSON in code fences, and a null suggestion", async () => {
    const llm = llmOf(
      '```json\n{"reply":"Nada a mudar.","suggestion":null}\n```',
    );
    expect(await chatNode(req, { llm, model: "m", prompt })).toEqual({
      status: "ok",
      reply: "Nada a mudar.",
    });
  });

  it("keeps the reply and drops a suggestion that points outside the node", async () => {
    const llm = llmOf(
      JSON.stringify({ reply: "Veja.", suggestion: { ...good, line: 99 } }),
    );
    expect(await chatNode(req, { llm, model: "m", prompt })).toEqual({
      status: "ok",
      reply: "Veja.",
    });
  });

  it("shows an answer that is not JSON as it is, with no suggestion", async () => {
    const llm = llmOf("  Resposta solta.  ");
    expect(await chatNode(req, { llm, model: "m", prompt })).toEqual({
      status: "ok",
      reply: "Resposta solta.",
    });
  });

  it("never shows the JSON itself when the reply field is missing", async () => {
    const llm = llmOf(JSON.stringify({ suggestion: null }));
    const res = await chatNode(req, { llm, model: "m", prompt });
    expect(res.status).toBe("ok");
  });

  it("cuts a long reply inside the JSON", async () => {
    const llm = llmOf(JSON.stringify({ reply: "palavra ".repeat(300) }));
    const res = await chatNode(req, { llm, model: "m", prompt });
    expect(res.status === "ok" && res.reply.endsWith("…")).toBe(true);
  });
});

describe("structureText", () => {
  it("shapes the text into a suggestion, with the text as the user turn", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ suggestion: good }));
    const res = await structureText(sreq, {
      llm: { complete },
      model: "m",
      prompt,
    });
    expect(res).toEqual({ status: "ok", suggestion: good });
    const { messages } = complete.mock.calls[0]?.[0] ?? { messages: [] };
    expect(messages.at(-1)).toEqual({ role: "user", content: sreq.text });
    expect(messages[0].content).toContain("PROMPT");
  });

  it("says none when the text holds no suggestion, or it is not valid", async () => {
    for (const answer of [
      '{"suggestion":null}',
      "texto solto",
      JSON.stringify({ suggestion: { ...good, line: 1 } }),
    ]) {
      expect(
        await structureText(sreq, {
          llm: llmOf(answer),
          model: "m",
          prompt,
        }),
      ).toEqual({ status: "none" });
    }
  });

  it("answers no-key without a client and error on a failure", async () => {
    expect(await structureText(sreq, { model: "m", prompt })).toEqual({
      status: "no-key",
    });
    const llm: LlmClient = {
      complete: vi.fn().mockRejectedValue(new Error("boom")),
    };
    expect(
      (await structureText(sreq, { llm, model: "m", prompt })).status,
    ).toBe("error");
  });
});

describe("the prompts of the suggestion", () => {
  it("the chat asks for JSON with the suggestion field, in both languages", () => {
    expect(buildChatPrompt("R", lang, "pt-BR").text).toContain('"suggestion"');
    expect(buildChatPrompt("R", lang, "en").text).toContain('"suggestion"');
  });

  it("the structuring prompt carries the rules and asks for null when there is none", () => {
    const pt = buildStructurePrompt("REGRAS PTS", lang, "pt-BR").text;
    expect(pt).toContain("REGRAS PTS");
    expect(pt).toContain("null");
    const en = buildStructurePrompt("RULES STE", lang, "en").text;
    expect(en).toContain("RULES STE");
    expect(en).not.toContain("sugestão de melhoria");
  });
});
