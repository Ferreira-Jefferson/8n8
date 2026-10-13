import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExplainRequest } from "@code2n8n/model";
import { afterAll, describe, expect, it } from "vitest";
import { composeExplain, resolvePort } from "../main";

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
  nodeId: "fn:f",
  nodeName: "f",
  nodeKind: "function",
  code: "def f():\n    return 1",
  range: { start: 1, end: 2 },
  calls: [],
  calledBy: [],
};

const draftReply = JSON.stringify({
  summary: "s",
  inputs: [],
  outputs: [],
  suggestions: [],
});

/** Fake client: answers verdicts to the reviewer (its system prompt asks for "verdicts"), the draft otherwise. */
function fakeFactory() {
  const keys: string[] = [];
  const baseURLs: (string | undefined)[] = [];
  const seen: { role: "draft" | "review"; model: string; system: string }[] =
    [];
  const createClient = (key: string, baseURL: string | undefined) => {
    keys.push(key);
    baseURLs.push(baseURL);
    return {
      async complete(r: {
        model: string;
        messages: { role: string; content: string }[];
      }) {
        const system =
          r.messages.find((m) => m.role === "system")?.content ?? "";
        const role = system.includes('"verdicts"') ? "review" : "draft";
        seen.push({ role, model: r.model, system });
        if (role === "draft") return draftReply;
        const user = r.messages.find((m) => m.role === "user")?.content ?? "";
        const verdicts = [...user.matchAll(/^- (\w+): /gm)].map(([, id]) => ({
          id,
          supported: true,
          evidence: [1],
        }));
        return JSON.stringify({ verdicts });
      },
    };
  };
  const drafts = () => seen.filter((s) => s.role === "draft");
  const reviews = () => seen.filter((s) => s.role === "review");
  return { keys, baseURLs, seen, drafts, reviews, createClient };
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
    expect(withModel.drafts()[0]?.model).toBe("x/y");

    const withDefault = fakeFactory();
    await composeExplain(
      { OPENROUTER_API_KEY: "k" },
      { createClient: withDefault.createClient, ptsRules, cacheDir: dir("d") },
    )(req);
    expect(withDefault.drafts()[0]?.model).toBe(
      "~deepseek/deepseek-v4-flash-latest",
    );
  });

  it("the system prompt carries the PTS text read from disk", async () => {
    const f = fakeFactory();
    await composeExplain(
      { OPENROUTER_API_KEY: "k" },
      { createClient: f.createClient, ptsRules, cacheDir: dir("e") },
    )(req);
    expect(f.drafts()[0]?.system).toContain(ptsRules);
    expect(ptsRules.length).toBeGreaterThan(100);
  });

  it("CODE2N8N_REVIEW_MODEL=r/x goes to the reviewer and the summary model to the draft (FID-15)", async () => {
    const f = fakeFactory();
    const res = await composeExplain(
      {
        OPENROUTER_API_KEY: "k",
        CODE2N8N_MODEL: "x/y",
        CODE2N8N_REVIEW_MODEL: "r/x",
      },
      { createClient: f.createClient, ptsRules, cacheDir: dir("f") },
    )(req);
    expect(res.status).toBe("ok");
    expect(f.drafts().map((s) => s.model)).toEqual(["x/y"]);
    expect(f.reviews().map((s) => s.model)).toEqual(["r/x"]);
  });

  it("without CODE2N8N_REVIEW_MODEL (or empty) the reviewer uses the summary model (FID-15)", async () => {
    for (const [name, env] of [
      ["g", { OPENROUTER_API_KEY: "k", CODE2N8N_MODEL: "x/y" }],
      [
        "h",
        {
          OPENROUTER_API_KEY: "k",
          CODE2N8N_MODEL: "x/y",
          CODE2N8N_REVIEW_MODEL: "",
        },
      ],
    ] as const) {
      const f = fakeFactory();
      await composeExplain(env, {
        createClient: f.createClient,
        ptsRules,
        cacheDir: dir(name),
      })(req);
      expect(f.drafts().map((s) => s.model)).toEqual(["x/y"]);
      expect(f.reviews().map((s) => s.model)).toEqual(["x/y"]);
    }
  });

  it("OPENROUTER_BASE_URL reaches createClient; unset or empty gives undefined", () => {
    const deps = (f: ReturnType<typeof fakeFactory>) => ({
      createClient: f.createClient,
      ptsRules,
      cacheDir: dir("i"),
    });
    const set = fakeFactory();
    composeExplain(
      { OPENROUTER_API_KEY: "k", OPENROUTER_BASE_URL: "http://127.0.0.1:9/v1" },
      deps(set),
    );
    expect(set.baseURLs).toEqual(["http://127.0.0.1:9/v1"]);

    const unset = fakeFactory();
    composeExplain({ OPENROUTER_API_KEY: "k" }, deps(unset));
    expect(unset.baseURLs).toEqual([undefined]);

    const empty = fakeFactory();
    composeExplain(
      { OPENROUTER_API_KEY: "k", OPENROUTER_BASE_URL: "" },
      deps(empty),
    );
    expect(empty.baseURLs).toEqual([undefined]);
  });

  it("CODE2N8N_CACHE_DIR replaces deps.cacheDir; unset or empty keeps deps.cacheDir", async () => {
    const custom = join(cacheDir, "x");
    await composeExplain(
      { OPENROUTER_API_KEY: "k", CODE2N8N_CACHE_DIR: custom },
      {
        createClient: fakeFactory().createClient,
        ptsRules,
        cacheDir: dir("j"),
      },
    )(req);
    expect(readdirSync(join(custom, "nodes"))).toHaveLength(1);
    expect(existsSync(dir("j"))).toBe(false);

    for (const [name, env] of [
      ["k", { OPENROUTER_API_KEY: "k" }],
      ["l", { OPENROUTER_API_KEY: "k", CODE2N8N_CACHE_DIR: "" }],
    ] as const) {
      await composeExplain(env, {
        createClient: fakeFactory().createClient,
        ptsRules,
        cacheDir: dir(name),
      })(req);
      expect(readdirSync(join(dir(name), "nodes"))).toHaveLength(1);
    }
  });
});

describe("resolvePort", () => {
  it("is 4317 without CODE2N8N_PORT or when it is empty", () => {
    expect(resolvePort({})).toBe(4317);
    expect(resolvePort({ CODE2N8N_PORT: "" })).toBe(4317);
  });

  it("reads a valid port from CODE2N8N_PORT", () => {
    expect(resolvePort({ CODE2N8N_PORT: "4319" })).toBe(4319);
  });

  it("falls back to 4317 for a value that is not a port", () => {
    expect(resolvePort({ CODE2N8N_PORT: "abc" })).toBe(4317);
  });
});
