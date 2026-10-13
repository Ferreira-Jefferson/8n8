import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExplainRequest } from "@code2n8n/model";
import { afterAll, describe, expect, it } from "vitest";
import { composeExplain } from "../main";

const ptsRules = readFileSync(
  new URL(
    "../../../../docs/portugues-tecnico-simplificado.md",
    import.meta.url,
  ),
  "utf8",
);
const cacheDir = mkdtempSync(join(tmpdir(), "code2n8n-main-"));
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

const req: ExplainRequest = {
  nodeName: "f",
  nodeKind: "function",
  code: "def f():\n    return 1",
  range: { start: 1, end: 2 },
  calls: [],
  calledBy: [],
};

const reply = JSON.stringify({
  summary: "s",
  inputs: [],
  outputs: [],
  suggestions: [],
});

function fakeFactory() {
  const keys: string[] = [];
  const seen: { model: string; system: string }[] = [];
  const createClient = (key: string) => {
    keys.push(key);
    return {
      async complete(r: {
        model: string;
        messages: { role: string; content: string }[];
      }) {
        seen.push({
          model: r.model,
          system: r.messages.find((m) => m.role === "system")?.content ?? "",
        });
        return reply;
      },
    };
  };
  return { keys, seen, createClient };
}

const dir = (name: string) => join(cacheDir, name);

describe("composeExplain", () => {
  it("without OPENROUTER_API_KEY: no client is built and explain answers no-key (CORE-19)", async () => {
    const f = fakeFactory();
    const explain = composeExplain(
      {},
      { createClient: f.createClient, ptsRules, cacheDir: dir("a") },
    );
    expect(await explain(req)).toEqual({ status: "no-key" });
    expect(f.keys).toEqual([]);
  });

  it("with the key: the factory is called once with it", async () => {
    const f = fakeFactory();
    const explain = composeExplain(
      { OPENROUTER_API_KEY: "k-123" },
      { createClient: f.createClient, ptsRules, cacheDir: dir("b") },
    );
    await explain(req);
    await explain({ ...req, code: "def g():\n    return 2" });
    expect(f.keys).toEqual(["k-123"]);
  });

  it("CODE2N8N_MODEL=x/y reaches the client; the default applies without it (CORE-21)", async () => {
    const withModel = fakeFactory();
    await composeExplain(
      { OPENROUTER_API_KEY: "k", CODE2N8N_MODEL: "x/y" },
      { createClient: withModel.createClient, ptsRules, cacheDir: dir("c") },
    )(req);
    expect(withModel.seen[0]?.model).toBe("x/y");

    const withDefault = fakeFactory();
    await composeExplain(
      { OPENROUTER_API_KEY: "k" },
      { createClient: withDefault.createClient, ptsRules, cacheDir: dir("d") },
    )(req);
    expect(withDefault.seen[0]?.model).toBe(
      "~deepseek/deepseek-v4-flash-latest",
    );
  });

  it("the system prompt carries the PTS text read from disk", async () => {
    const f = fakeFactory();
    await composeExplain(
      { OPENROUTER_API_KEY: "k" },
      { createClient: f.createClient, ptsRules, cacheDir: dir("e") },
    )(req);
    expect(f.seen[0]?.system).toContain(ptsRules);
    expect(ptsRules.length).toBeGreaterThan(100);
  });
});
