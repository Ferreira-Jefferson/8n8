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
  buildStepPrompt,
  buildSystemPrompt,
  buildTitlePrompt,
  buildTitleReviewerPrompt,
} from "@code2n8n/explain";
import { readSourceFolder } from "@code2n8n/input";
import { createPythonExtractor } from "@code2n8n/lang-python";
import type {
  ExplainRequest,
  ProjectResponse,
  TitleRequest,
} from "@code2n8n/model";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import {
  composeExplain,
  composeReadProject,
  composeTitles,
  listenOptions,
  resolvePort,
} from "../main";

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

const titleReply = JSON.stringify({
  titles: [{ id: "n1", title: "Devolver um" }],
});

const titleReq: TitleRequest = {
  items: [
    {
      nodeId: "fn:f",
      cacheKey: "fn:f",
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

describe("composeExplain for a step (VID-28)", () => {
  it("uses the step prompt for a step request and the full prompt for a function", async () => {
    const f = fakeFactory();
    const explain = composeExplain(
      { OPENROUTER_API_KEY: "k" },
      { createClient: f.createClient, ptsRules, cacheDir: dir("step") },
    );
    await explain({
      ...req,
      nodeId: "fn:f/s0",
      nodeName: "Código",
      nodeKind: "code",
    });
    await explain(req);
    const [step, full] = f.drafts();
    expect(step?.system).toBe(buildStepPrompt(ptsRules).text);
    expect(full?.system).toBe(buildSystemPrompt(ptsRules).text);
  });
});

describe("composeTitles (VID-14, VID-17)", () => {
  it("without OPENROUTER_API_KEY (or empty): no client is built and titles answer no-key", async () => {
    for (const env of [{}, { OPENROUTER_API_KEY: "" }]) {
      const f = fakeFactory();
      const titles = composeTitles(env, {
        createClient: f.createClient,
        ptsRules,
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
        CODE2N8N_MODEL: "x/y",
        CODE2N8N_REVIEW_MODEL: "r/x",
      },
      { createClient: f.createClient, ptsRules, cacheDir: dir("t-b") },
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
      ["x/y", buildTitlePrompt(ptsRules).text],
    ]);
    expect(f.reviews().map((s) => [s.model, s.system])).toEqual([
      ["r/x", buildTitleReviewerPrompt().text],
    ]);
  });

  it("empty env values count as absent: no base URL, the default model for both", async () => {
    const f = fakeFactory();
    await composeTitles(
      {
        OPENROUTER_API_KEY: "k",
        OPENROUTER_BASE_URL: "",
        CODE2N8N_MODEL: "",
        CODE2N8N_REVIEW_MODEL: "",
      },
      { createClient: f.createClient, ptsRules, cacheDir: dir("t-c") },
    )(titleReq);
    expect(f.baseURLs).toEqual([undefined]);
    expect(f.seen.map((s) => s.model)).toEqual([
      "~deepseek/deepseek-v4-flash-latest",
      "~deepseek/deepseek-v4-flash-latest",
    ]);
  });

  it("keeps titles in <CODE2N8N_CACHE_DIR>/titles, or <deps.cacheDir>/titles when unset or empty", async () => {
    const custom = join(cacheDir, "t-x");
    await composeTitles(
      { OPENROUTER_API_KEY: "k", CODE2N8N_CACHE_DIR: custom },
      {
        createClient: fakeFactory().createClient,
        ptsRules,
        cacheDir: dir("t-d"),
      },
    )(titleReq);
    expect(readdirSync(join(custom, "titles"))).toHaveLength(1);
    expect(existsSync(dir("t-d"))).toBe(false);

    for (const [name, env] of [
      ["t-e", { OPENROUTER_API_KEY: "k" }],
      ["t-f", { OPENROUTER_API_KEY: "k", CODE2N8N_CACHE_DIR: "" }],
    ] as const) {
      const f = fakeFactory();
      const titles = composeTitles(env, {
        createClient: f.createClient,
        ptsRules,
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

const fixtureSrc = new URL(
  "../../../languages/python/src/__tests__/fixtures/projeto-loja",
  import.meta.url,
);

/** Fixture copy in os.tmpdir() plus an oversized file and a latin-1 file. */
function makeLoja(): string {
  const base = mkdtempSync(join(tmpdir(), "code2n8n-loja-"));
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

const extractor = await createPythonExtractor();

describe("composeReadProject", () => {
  const readProject = composeReadProject(readSourceFolder, extractor);

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
      { path: "grande.py", reason: "too-large" },
      { path: "latin1.py", reason: "not-utf8" },
    ]);
  });

  it("gives not-found for a missing path and for a file path (PROJ-05)", async () => {
    const loja = makeLoja();
    const missing = await readProject(join(loja, "nao-existe"));
    const file = await readProject(join(loja, "main.py"));
    rmSync(join(loja, ".."), { recursive: true, force: true });
    expect(missing).toEqual({ kind: "not-found" });
    expect(file).toEqual({ kind: "not-found" });
  });

  it("explain re-reads the disk: a new line in calculo.py reaches the explain call (AD-015)", async () => {
    const loja = makeLoja();
    const received: ExplainRequest[] = [];
    const app = createApp({
      extractor,
      explain: async (r) => {
        received.push(r);
        return { status: "no-key" };
      },
      titles: async () => ({ status: "ok", titles: [] }),
      readProject,
      port: 4317,
    });
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: {
          host: "127.0.0.1:4317",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const nodeId = "file:frete/calculo.py/fn:calcular_frete";

    // PROJ-07: map and explain leave the folder untouched.
    const before = snapshot(loja);
    expect((await post("/api/project", { path: loja })).status).toBe(200);
    expect((await post("/api/explain", { root: loja, nodeId })).status).toBe(
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
    await post("/api/explain", { root: loja, nodeId });
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
      extractor,
      explain: composeExplain(
        { OPENROUTER_API_KEY: "k" },
        { createClient: f.createClient, ptsRules, cacheDir: cache },
      ),
      titles: async () => ({ status: "ok", titles: [] }),
      readProject,
      port: 4317,
    });
    const explain = async (root: string) => {
      const res = await app.request("/api/explain", {
        method: "POST",
        headers: {
          host: "127.0.0.1:4317",
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

describe("listenOptions", () => {
  it("listens on loopback only (PROJ-08)", () => {
    expect(listenOptions(4317)).toEqual({
      port: 4317,
      hostname: "127.0.0.1",
    });
  });
});
