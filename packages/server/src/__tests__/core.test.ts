import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  buildStepSummaryPrompt,
  buildSummaryPrompt,
  buildTitlePrompt,
  buildTitleReviewerPrompt,
} from "@8n8/explain";
import { type ReadFilter, readSourceFolder } from "@8n8/input";
import { pythonPlugin } from "@8n8/lang-python";
import { typescriptPlugin } from "@8n8/lang-typescript";
import type {
  ExplainRequest,
  LanguagePlugin,
  ProjectResponse,
  TitleRequest,
} from "@8n8/model";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import {
  composeExplain,
  composeReadProject,
  composeTitles,
  createCore,
  languagePlugins,
  listenOptions,
  resolvePort,
} from "../core";
import { createSettingsService } from "../settings";
import { llmOf as llmFrom } from "./llm-of";
import { TEST_TOKEN } from "./test-token";

const ptsRules = readFileSync(
  new URL(
    "../../../../docs/portugues-tecnico-simplificado.md",
    import.meta.url,
  ),
  "utf8",
);
const cacheDir = mkdtempSync(join(tmpdir(), "8n8-main-"));
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

const req: ExplainRequest = {
  nodeId: "python|fn:f",
  language: "python",
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

/** Fake client: answers verdicts to a reviewer (its system prompt asks for "verdicts"), titles to the title prompt, the draft otherwise. */
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
        if (system.startsWith("Você escreve títulos")) return titleReply;
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

type Env = Record<string, string | undefined>;

/** The server's LLM getter, with the fake client in place of the real one. */
function llmOf(env: Env, f: ReturnType<typeof fakeFactory>) {
  return llmFrom(env, (config) =>
    config.apiKey === undefined
      ? undefined
      : f.createClient(config.apiKey, config.baseURL),
  );
}

/** The summary part of composeExplain, asked for real. */
function composeSummary(env: Env, deps: Parameters<typeof composeExplain>[1]) {
  const explain = composeExplain(env, deps);
  return (r: ExplainRequest) => explain("summary", r, { cachedOnly: false });
}

/** A settings store in memory, empty. */
const noSettings = () => ({ read: async () => ({}), write: async () => {} });

const PY = { label: "Python", commentPrefix: "#" };

const titleReply = JSON.stringify({
  titles: [{ id: "n1", title: "Devolver um" }],
});

const titleReq: TitleRequest = {
  items: [
    {
      nodeId: "fn:f",
      cacheKey: "python|fn:f",
      language: "python",
      kind: "function",
      name: "f",
      code: "def f():\n    return 1",
      range: { start: 1, end: 2 },
      calls: [],
      calledBy: [],
    },
  ],
};

const dir = (name: string) => join(cacheDir, name);

describe("composeExplain", () => {
  it("without OPENROUTER_API_KEY: no client is built and explain answers no-key (CORE-19)", async () => {
    const f = fakeFactory();
    const explain = composeSummary(
      {},
      {
        llm: llmOf({}, f),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir("a"),
      },
    );
    expect(await explain(req)).toEqual({ status: "no-key" });
    expect(f.keys).toEqual([]);
  });

  it("with the key: the factory is called once with it", async () => {
    const f = fakeFactory();
    const explain = composeSummary(
      { OPENROUTER_API_KEY: "k-123" },
      {
        llm: llmOf({ OPENROUTER_API_KEY: "k-123" }, f),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir("b"),
      },
    );
    await explain(req);
    await explain({ ...req, code: "def g():\n    return 2" });
    expect(f.keys).toEqual(["k-123"]);
  });

  it("APP8N8_MODEL=x/y reaches the client; the default applies without it (CORE-21)", async () => {
    const withModel = fakeFactory();
    await composeSummary(
      { OPENROUTER_API_KEY: "k", APP8N8_MODEL: "x/y" },
      {
        llm: llmOf({ OPENROUTER_API_KEY: "k", APP8N8_MODEL: "x/y" }, withModel),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir("c"),
      },
    )(req);
    expect(withModel.drafts()[0]?.model).toBe("x/y");

    const withDefault = fakeFactory();
    await composeSummary(
      { OPENROUTER_API_KEY: "k" },
      {
        llm: llmOf({ OPENROUTER_API_KEY: "k" }, withDefault),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir("d"),
      },
    )(req);
    expect(withDefault.drafts()[0]?.model).toBe(
      "~deepseek/deepseek-v4-flash-latest",
    );
  });

  it("the system prompt carries the PTS text read from disk", async () => {
    const f = fakeFactory();
    await composeSummary(
      { OPENROUTER_API_KEY: "k" },
      {
        llm: llmOf({ OPENROUTER_API_KEY: "k" }, f),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir("e"),
      },
    )(req);
    expect(f.drafts()[0]?.system).toContain(ptsRules);
    expect(ptsRules.length).toBeGreaterThan(100);
  });

  it("APP8N8_REVIEW_MODEL=r/x goes to the reviewer and the summary model to the draft (FID-15)", async () => {
    const f = fakeFactory();
    const res = await composeSummary(
      {
        OPENROUTER_API_KEY: "k",
        APP8N8_MODEL: "x/y",
        APP8N8_REVIEW_MODEL: "r/x",
      },
      {
        llm: llmOf(
          {
            OPENROUTER_API_KEY: "k",
            APP8N8_MODEL: "x/y",
            APP8N8_REVIEW_MODEL: "r/x",
          },
          f,
        ),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir("f"),
      },
    )(req);
    expect(res.status).toBe("ok");
    expect(f.drafts().map((s) => s.model)).toEqual(["x/y"]);
    expect(f.reviews().map((s) => s.model)).toEqual(["r/x"]);
  });

  it("without APP8N8_REVIEW_MODEL (or empty) the reviewer uses the summary model (FID-15)", async () => {
    for (const [name, env] of [
      ["g", { OPENROUTER_API_KEY: "k", APP8N8_MODEL: "x/y" }],
      [
        "h",
        {
          OPENROUTER_API_KEY: "k",
          APP8N8_MODEL: "x/y",
          APP8N8_REVIEW_MODEL: "",
        },
      ],
    ] as const) {
      const f = fakeFactory();
      await composeSummary(env, {
        llm: llmOf(env, f),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir(name),
      })(req);
      expect(f.drafts().map((s) => s.model)).toEqual(["x/y"]);
      expect(f.reviews().map((s) => s.model)).toEqual(["x/y"]);
    }
  });

  it("OPENROUTER_BASE_URL reaches createClient; unset or empty gives undefined", async () => {
    const urlOf = async (env: Env, name: string) => {
      const f = fakeFactory();
      await composeSummary(env, {
        llm: llmOf(env, f),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir(name),
      })(req);
      return f.baseURLs;
    };
    expect(
      await urlOf(
        {
          OPENROUTER_API_KEY: "k",
          OPENROUTER_BASE_URL: "http://127.0.0.1:9/v1",
        },
        "i1",
      ),
    ).toEqual(["http://127.0.0.1:9/v1"]);
    expect(await urlOf({ OPENROUTER_API_KEY: "k" }, "i2")).toEqual([undefined]);
    expect(
      await urlOf({ OPENROUTER_API_KEY: "k", OPENROUTER_BASE_URL: "" }, "i3"),
    ).toEqual([undefined]);
  });

  it("APP8N8_CACHE_DIR replaces deps.cacheDir; unset or empty keeps deps.cacheDir", async () => {
    const custom = join(cacheDir, "x");
    await composeSummary(
      { OPENROUTER_API_KEY: "k", APP8N8_CACHE_DIR: custom },
      {
        llm: llmOf(
          { OPENROUTER_API_KEY: "k", APP8N8_CACHE_DIR: custom },
          fakeFactory(),
        ),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir("j"),
      },
    )(req);
    expect(readdirSync(join(custom, "nodes"))).toHaveLength(1);
    expect(existsSync(dir("j"))).toBe(false);

    for (const [name, env] of [
      ["k", { OPENROUTER_API_KEY: "k" }],
      ["l", { OPENROUTER_API_KEY: "k", APP8N8_CACHE_DIR: "" }],
    ] as const) {
      await composeSummary(env, {
        llm: llmOf(env, fakeFactory()),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir(name),
      })(req);
      expect(readdirSync(join(dir(name), "nodes"))).toHaveLength(1);
    }
  });
});

describe("composeExplain for a step (VID-28)", () => {
  it("uses the step prompt for a step request and the full prompt for a function", async () => {
    const f = fakeFactory();
    const explain = composeSummary(
      { OPENROUTER_API_KEY: "k" },
      {
        llm: llmOf({ OPENROUTER_API_KEY: "k" }, f),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir("step"),
      },
    );
    await explain({
      ...req,
      nodeId: "fn:f/s0",
      nodeName: "Código",
      nodeKind: "code",
    });
    await explain(req);
    const [step, full] = f.drafts();
    expect(step?.system).toBe(buildStepSummaryPrompt(ptsRules, PY).text);
    expect(full?.system).toBe(buildSummaryPrompt(ptsRules, PY).text);
  });
});

describe("composeTitles (VID-14, VID-17)", () => {
  it("without OPENROUTER_API_KEY (or empty): no client is built and titles answer no-key", async () => {
    for (const env of [{}, { OPENROUTER_API_KEY: "" }]) {
      const f = fakeFactory();
      const titles = composeTitles(env, {
        llm: llmOf(env, f),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir("t-a"),
      });
      expect(await titles(titleReq)).toEqual({ status: "no-key", titles: [] });
      expect(f.keys).toEqual([]);
    }
  });

  it("with the key: one client with OPENROUTER_BASE_URL, the title model and the review model", async () => {
    const f = fakeFactory();
    const titles = composeTitles(
      {
        OPENROUTER_API_KEY: "k-1",
        OPENROUTER_BASE_URL: "http://127.0.0.1:9/v1",
        APP8N8_MODEL: "x/y",
        APP8N8_REVIEW_MODEL: "r/x",
      },
      {
        llm: llmOf(
          {
            OPENROUTER_API_KEY: "k-1",
            OPENROUTER_BASE_URL: "http://127.0.0.1:9/v1",
            APP8N8_MODEL: "x/y",
            APP8N8_REVIEW_MODEL: "r/x",
          },
          f,
        ),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir("t-b"),
      },
    );
    expect(await titles(titleReq)).toEqual({
      status: "ok",
      titles: [
        { nodeId: "fn:f", text: "Devolver um", lines: [1], fromCache: false },
      ],
    });
    expect(f.keys).toEqual(["k-1"]);
    expect(f.baseURLs).toEqual(["http://127.0.0.1:9/v1"]);
    expect(f.drafts().map((s) => [s.model, s.system])).toEqual([
      ["x/y", buildTitlePrompt(ptsRules, PY).text],
    ]);
    expect(f.reviews().map((s) => [s.model, s.system])).toEqual([
      ["r/x", buildTitleReviewerPrompt(PY).text],
    ]);
  });

  it("empty env values count as absent: no base URL, the default model for both", async () => {
    const f = fakeFactory();
    await composeTitles(
      {
        OPENROUTER_API_KEY: "k",
        OPENROUTER_BASE_URL: "",
        APP8N8_MODEL: "",
        APP8N8_REVIEW_MODEL: "",
      },
      {
        llm: llmOf(
          {
            OPENROUTER_API_KEY: "k",
            OPENROUTER_BASE_URL: "",
            APP8N8_MODEL: "",
            APP8N8_REVIEW_MODEL: "",
          },
          f,
        ),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir("t-c"),
      },
    )(titleReq);
    expect(f.baseURLs).toEqual([undefined]);
    expect(f.seen.map((s) => s.model)).toEqual([
      "~deepseek/deepseek-v4-flash-latest",
      "~deepseek/deepseek-v4-flash-latest",
    ]);
  });

  it("keeps titles in <APP8N8_CACHE_DIR>/titles, or <deps.cacheDir>/titles when unset or empty", async () => {
    const custom = join(cacheDir, "t-x");
    await composeTitles(
      { OPENROUTER_API_KEY: "k", APP8N8_CACHE_DIR: custom },
      {
        llm: llmOf(
          { OPENROUTER_API_KEY: "k", APP8N8_CACHE_DIR: custom },
          fakeFactory(),
        ),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir("t-d"),
      },
    )(titleReq);
    expect(readdirSync(join(custom, "titles"))).toHaveLength(1);
    expect(existsSync(dir("t-d"))).toBe(false);

    for (const [name, env] of [
      ["t-e", { OPENROUTER_API_KEY: "k" }],
      ["t-f", { OPENROUTER_API_KEY: "k", APP8N8_CACHE_DIR: "" }],
    ] as const) {
      const f = fakeFactory();
      const titles = composeTitles(env, {
        llm: llmOf(env, f),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir(name),
      });
      await titles(titleReq);
      expect(readdirSync(join(dir(name), "titles"))).toHaveLength(1);
      expect(await titles(titleReq)).toMatchObject({
        status: "ok",
        titles: [{ fromCache: true }],
      });
      expect(f.seen).toHaveLength(2);
    }
  });
});

describe("the LLM setup of the core (one client per settings, CFG-17)", () => {
  it("resolves the config from the environment and builds the client once", async () => {
    const f = fakeFactory();
    const llm = llmOf({ OPENROUTER_API_KEY: "k", APP8N8_MODEL: "x/y" }, f);
    const setup = await llm();
    expect(await llm()).toBe(setup);
    expect(setup.config).toEqual({
      provider: "openrouter",
      apiKey: "k",
      baseURL: undefined,
      model: "x/y",
      reviewModel: "x/y",
    });
    expect(setup.client).toBeDefined();
    expect(f.keys).toEqual(["k"]);
  });

  it("composeExplain and composeTitles share the one client: one factory call", async () => {
    const f = fakeFactory();
    const env = { OPENROUTER_API_KEY: "k" };
    const llm = llmOf(env, f);
    const explain = composeSummary(env, {
      llm,
      ptsRules,
      plugins: [pythonPlugin],
      cacheDir: dir("one-a"),
    });
    const titles = composeTitles(env, {
      llm,
      ptsRules,
      plugins: [pythonPlugin],
      cacheDir: dir("one-b"),
    });
    await explain(req);
    await titles(titleReq);
    expect(f.keys).toEqual(["k"]);
    expect(f.seen.length).toBeGreaterThan(2);
  });

  it("the default factory builds the real client for a configured provider and none without a key", async () => {
    const real = (env: Env) => createSettingsService(env, noSettings()).llm();
    expect((await real({})).client).toBeUndefined();
    expect((await real({ OPENROUTER_API_KEY: "k" })).client).toHaveProperty(
      "complete",
    );
    const local = await real({
      APP8N8_LLM_PROVIDER: "openai-compatible",
      APP8N8_LLM_BASE_URL: "http://localhost:11434/v1",
      APP8N8_MODEL: "llama3",
    });
    expect(local.client).toHaveProperty("complete");
    expect(local.config).toMatchObject({
      provider: "openai-compatible",
      apiKey: undefined,
      baseURL: "http://localhost:11434/v1",
      model: "llama3",
    });
  });

  it("an unknown provider fails at startup, naming the known ones", () => {
    expect(() =>
      createCore({
        env: { APP8N8_LLM_PROVIDER: "nope" },
        ptsRules: "regras",
        cacheDir: dir("nope"),
        historyFile: undefined,
        port: 4317,
        token: TEST_TOKEN,
        settings: noSettings(),
      }),
    ).toThrow(/desconhecido.*openrouter, openai, anthropic, openai-compatible/);
  });

  it("without a client both pipelines answer no-key, whatever the provider", async () => {
    const env = { APP8N8_LLM_PROVIDER: "openai-compatible" };
    const llm = llmOf(env, fakeFactory());
    expect((await llm()).client).toBeUndefined();
    expect(
      await composeSummary(env, {
        llm,
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir("nk-a"),
      })(req),
    ).toEqual({ status: "no-key" });
    expect(
      await composeTitles(env, {
        llm,
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir("nk-b"),
      })(titleReq),
    ).toEqual({ status: "no-key", titles: [] });
  });

  it("the provider id reaches the cache: another provider regenerates the same node", async () => {
    const same = { APP8N8_MODEL: "x/y", OPENROUTER_API_KEY: "k" };
    const other = {
      APP8N8_MODEL: "x/y",
      APP8N8_LLM_PROVIDER: "openai-compatible",
      APP8N8_LLM_API_KEY: "k",
    };
    const run = async (env: Env) => {
      const f = fakeFactory();
      const res = await composeSummary(env, {
        llm: llmOf(env, f),
        ptsRules,
        plugins: [pythonPlugin],
        cacheDir: dir("prov"),
      })(req);
      return { res, calls: f.seen.length };
    };
    expect((await run(same)).calls).toBe(2);
    expect((await run(same)).calls).toBe(0);
    const changed = await run(other);
    expect(changed.calls).toBe(2);
    expect(changed.res).toMatchObject({ update: ["model-or-prompt"] });
  });
});

describe("resolvePort", () => {
  it("is 4317 without APP8N8_PORT or when it is empty", () => {
    expect(resolvePort({})).toBe(4317);
    expect(resolvePort({ APP8N8_PORT: "" })).toBe(4317);
  });

  it("reads a valid port from APP8N8_PORT", () => {
    expect(resolvePort({ APP8N8_PORT: "4319" })).toBe(4319);
  });

  it("falls back to 4317 for a value that is not a port", () => {
    expect(resolvePort({ APP8N8_PORT: "abc" })).toBe(4317);
  });
});

const fixtureSrc = new URL(
  "../../../languages/python/src/__tests__/fixtures/projeto-loja",
  import.meta.url,
);

/** Fixture copy in os.tmpdir() plus an oversized file and a latin-1 file. */
function makeLoja(): string {
  const base = mkdtempSync(join(tmpdir(), "8n8-loja-"));
  const loja = join(base, "loja");
  cpSync(fixtureSrc, loja, { recursive: true });
  writeFileSync(join(loja, "grande.py"), "#".repeat(1_048_576 + 1));
  writeFileSync(join(loja, "latin1.py"), Buffer.from([0x78, 0x3d, 0xe9]));
  return loja;
}

/** path, size, mtimeMs and sha256 of every file under dir. */
function snapshot(dir: string, rel = ""): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((e) => {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) return snapshot(dir, r);
      const st = statSync(join(dir, r));
      const sha = createHash("sha256")
        .update(readFileSync(join(dir, r)))
        .digest("hex");
      return [`${r}|${st.size}|${st.mtimeMs}|${sha}`];
    });
}

describe("composeReadProject", () => {
  const readProject = composeReadProject(readSourceFolder, [pythonPlugin]);

  it("maps the folder: name, project name, 8 files, ignored files (PROJ-01, PROJ-06)", async () => {
    const loja = makeLoja();
    const read = await readProject(loja);
    rmSync(join(loja, ".."), { recursive: true, force: true });
    if (read.kind !== "ok") throw new Error("expected ok");
    const response: ProjectResponse = read.response;
    expect(response.name).toBe("loja");
    expect(response.graph.project).toEqual({ name: "loja" });
    expect(response.files).toHaveLength(8);
    expect(response.ignored).toEqual([
      { path: "grande.py", reason: "too-large", addable: true },
      { path: "latin1.py", reason: "not-utf8" },
    ]);
  });

  it("gives not-found for a missing path (PROJ-05)", async () => {
    const loja = makeLoja();
    const missing = await readProject(join(loja, "nao-existe"));
    rmSync(join(loja, ".."), { recursive: true, force: true });
    expect(missing).toEqual({ kind: "not-found" });
  });

  it("maps a single file: the project holds only that file", async () => {
    const loja = makeLoja();
    const file = await readProject(join(loja, "main.py"));
    rmSync(join(loja, ".."), { recursive: true, force: true });
    if (file.kind !== "ok") throw new Error("expected ok");
    expect(file.response.files.map((f) => f.path)).toEqual(["main.py"]);
  });

  it("explain re-reads the disk: a new line in calculo.py reaches the explain call (AD-015)", async () => {
    const loja = makeLoja();
    const received: ExplainRequest[] = [];
    const app = createApp({
      plugins: [pythonPlugin],
      explain: async (_part, r) => {
        received.push(r);
        return { status: "no-key" };
      },
      titles: async () => ({ status: "ok", titles: [] }),
      readProject,
      port: 4317,
      token: TEST_TOKEN,
    });
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: {
          host: "127.0.0.1:4317",
          "x-8n8-token": TEST_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const nodeId = "file:frete/calculo.py/fn:calcular_frete";

    // PROJ-07: map and explain leave the folder untouched.
    const before = snapshot(loja);
    expect((await post("/api/project", { path: loja })).status).toBe(200);
    expect((await post("/api/summary", { root: loja, nodeId })).status).toBe(
      200,
    );
    expect(snapshot(loja)).toEqual(before);
    expect(received[0]?.code).not.toContain("peso > 100");

    const file = join(loja, "frete", "calculo.py");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(
        "    return 20",
        ["    if peso > 100:", "        return 99", "    return 20"].join("\n"),
      ),
    );
    await post("/api/summary", { root: loja, nodeId });
    rmSync(join(loja, ".."), { recursive: true, force: true });
    expect(received[1]?.code).toContain("if peso > 100:");
  });

  it("the same folder typed three ways hits one cache entry: the identity uses the real path (CACHE-06, AD-015)", async () => {
    const loja = makeLoja();
    const alias = join(loja, "..", "atalho");
    symlinkSync(loja, alias, "junction");
    const f = fakeFactory();
    const cache = dir("m");
    const app = createApp({
      plugins: [pythonPlugin],
      explain: composeExplain(
        { OPENROUTER_API_KEY: "k" },
        {
          llm: llmOf({ OPENROUTER_API_KEY: "k" }, f),
          ptsRules,
          plugins: [pythonPlugin],
          cacheDir: cache,
        },
      ),
      titles: async () => ({ status: "ok", titles: [] }),
      readProject,
      port: 4317,
      token: TEST_TOKEN,
    });
    const explain = async (root: string) => {
      const res = await app.request("/api/summary", {
        method: "POST",
        headers: {
          host: "127.0.0.1:4317",
          "x-8n8-token": TEST_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          root,
          nodeId: "file:frete/calculo.py/fn:calcular_frete",
        }),
      });
      return { status: res.status, body: (await res.json()) as unknown };
    };

    const first = await explain(loja);
    // A `..` segment with a trailing separator, and a junction to the folder.
    const dotted = await explain(`${join(loja, "..", "loja")}${sep}`);
    const linked = await explain(alias);
    const entries = readdirSync(join(cache, "nodes"));
    rmSync(join(loja, ".."), { recursive: true, force: true });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: "ok", fromCache: false });
    const cached = {
      ...first,
      body: { ...(first.body as object), fromCache: true },
    };
    expect(dotted).toEqual(cached);
    expect(linked).toEqual(cached);
    expect(f.drafts()).toHaveLength(1);
    expect(entries).toHaveLength(1);
  });
});

describe("composeReadProject: the plugin registry", () => {
  const plugin = (
    id: string,
    extensions: string[],
    ignoredDirs: string[],
  ): LanguagePlugin => ({
    ...pythonPlugin,
    id,
    extensions,
    ignoredDirs,
  });

  it("asks the reader for the extensions and ignored folders of every plugin", async () => {
    const asked: ReadFilter[] = [];
    const readProject = composeReadProject(
      async (_path, filter) => {
        asked.push(filter);
        return { kind: "not-found" };
      },
      [plugin("a", [".a", ".b"], ["x"]), plugin("c", [".c"], ["y", "z"])],
    );

    expect(await readProject("/qualquer")).toEqual({ kind: "not-found" });
    expect(await readProject("/qualquer", ["big.a"])).toEqual({
      kind: "not-found",
    });
    expect(asked).toEqual([
      {
        extensions: [".a", ".b", ".c"],
        ignoredDirs: ["x", "y", "z"],
        include: [],
      },
      {
        extensions: [".a", ".b", ".c"],
        ignoredDirs: ["x", "y", "z"],
        include: ["big.a"],
      },
    ]);
  });

  it("registers the Python and TypeScript plugins", () => {
    expect(languagePlugins).toEqual([pythonPlugin, typescriptPlugin]);
  });

  it("gives every plugin its own id and its own extensions", () => {
    const ids = languagePlugins.map((p) => p.id);
    const extensions = languagePlugins.flatMap((p) => p.extensions);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(extensions).size).toBe(extensions.length);
  });

  it("maps the files the reader returns with the plugins, naming the project", async () => {
    const readProject = composeReadProject(
      async () => ({
        kind: "ok",
        name: "mista",
        root: "/mista",
        files: [
          { path: "a.py", source: "def f():\n    pass\n" },
          { path: "b.txt", source: "oi" },
        ],
        ignored: [],
      }),
      [pythonPlugin],
    );
    const read = await readProject("/mista");
    if (read.kind !== "ok") throw new Error("expected ok");

    expect(read.response.graph.project).toEqual({ name: "mista" });
    expect(read.response.graph.language).toBe("python");
    expect(read.response.graph.nodes.map((n) => n.id)).toEqual([
      "file:a.py",
      "file:a.py/fn:f",
      "file:a.py/fn:f/s0",
    ]);
  });
});

describe("listenOptions", () => {
  it("listens on loopback only (PROJ-08)", () => {
    expect(listenOptions(4317)).toEqual({
      port: 4317,
      hostname: "127.0.0.1",
    });
  });
});

describe("createCore (DIST-13)", () => {
  const dir = mkdtempSync(join(tmpdir(), "8n8-core-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const core = (historyFile: string | undefined) =>
    createCore({
      env: {},
      ptsRules: "regras",
      cacheDir: join(dir, "cache"),
      historyFile,
      port: 4317,
      token: TEST_TOKEN,
      settings: noSettings(),
    });
  const get = (app: ReturnType<typeof core>, path: string) =>
    app.request(path, {
      headers: { host: "127.0.0.1:4317", "x-8n8-token": TEST_TOKEN },
    });

  it("serves the languages of the built-in plugins from the options alone", async () => {
    const res = await get(core(undefined), "/api/languages");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { languages: { id: string }[] };
    expect(body.languages.map((l) => l.id)).toEqual(["python", "typescript"]);
  });

  it("keeps the maps in the history it receives, and none without one", async () => {
    const saveAMap = (app: ReturnType<typeof core>) =>
      app.request("/api/graph", {
        method: "POST",
        headers: {
          host: "127.0.0.1:4317",
          "x-8n8-token": TEST_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ source: "def f():\n    pass\n" }),
      });
    const items = async (app: ReturnType<typeof core>) => {
      // The save runs after the response (saveLater).
      await new Promise((r) => setTimeout(r, 50));
      const res = await get(app, "/api/history");
      return ((await res.json()) as { items: unknown[] }).items;
    };

    // An in-memory database: on Windows an open file blocks the temp folder cleanup.
    const withHistory = core(":memory:");
    expect((await saveAMap(withHistory)).status).toBe(200);
    expect(await items(withHistory)).toHaveLength(1);

    const without = core(undefined);
    expect((await saveAMap(without)).status).toBe(200);
    expect(await items(without)).toEqual([]);
  });

  it("never reads the process environment nor the repository layout", () => {
    const source = readFileSync(join(__dirname, "..", "core.ts"), "utf8");
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/import\.meta\.url/);
    expect(source).not.toMatch(/process\.loadEnvFile/);
    expect(source).not.toMatch(/@hono\/node-server/);
  });
});
