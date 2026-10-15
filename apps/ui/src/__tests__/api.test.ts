import type {
  Graph,
  NodeTitle,
  ProjectResponse,
  SettingsResponse,
} from "@8n8/model";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteHistory,
  fetchGraph,
  fetchHistory,
  fetchHistoryEntry,
  fetchLanguages,
  fetchProject,
  fetchSettings,
  fetchSuggestions,
  fetchSummary,
  fetchTitles,
  saveSettings,
  setSessionToken,
  starHistory,
} from "../api";

const graph: Graph = { language: "python", empty: false, nodes: [], edges: [] };

function fakeFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setSessionToken(null);
});

describe("fetchGraph", () => {
  const language = { id: "python", label: "Python", uncertain: false };

  it("posts { source } to /api/graph and returns the graph with the language", async () => {
    const fn = fakeFetch(200, { graph, language });
    const result = await fetchGraph("x = 1");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/graph");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ source: "x = 1" });
    expect(result).toEqual({ graph, language });
  });

  it("rejects with an error on 400", async () => {
    fakeFetch(400, { error: "bad" });
    await expect(fetchGraph("x")).rejects.toThrow(Error);
  });

  it("rejects when the network fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(fetchGraph("x")).rejects.toThrow(TypeError);
  });
});

describe("fetchLanguages", () => {
  const languages = [
    { id: "python", label: "Python", extensions: [".py"] },
    { id: "typescript", label: "TypeScript", extensions: [".ts", ".tsx"] },
  ];

  it("gets /api/languages and returns the list", async () => {
    const fn = fakeFetch(200, { languages });
    const result = await fetchLanguages();
    const [url] = fn.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/languages");
    expect(result).toEqual(languages);
  });

  it("gives [] on an HTTP error", async () => {
    fakeFetch(500, { error: "boom" });
    expect(await fetchLanguages()).toEqual([]);
  });

  it("gives [] when the body has no list", async () => {
    fakeFetch(200, {});
    expect(await fetchLanguages()).toEqual([]);
  });

  it("gives [] when the network fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await fetchLanguages()).toEqual([]);
  });
});

describe("fetchProject (PROJ-05)", () => {
  const project: ProjectResponse = {
    name: "loja",
    graph: { ...graph, project: { name: "loja" } },
    files: [{ path: "main.py", source: "x = 1\n" }],
    ignored: [{ path: "grande.py", reason: "too-large" }],
  };

  it("posts { path } as JSON to /api/project and returns the body on 200", async () => {
    const fn = fakeFetch(200, project);
    const result = await fetchProject("C:/loja");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/project");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(JSON.parse(init.body as string)).toEqual({ path: "C:/loja" });
    expect(result).toEqual(project);
  });

  it("posts the files put on the map as include (CLEAN-06)", async () => {
    const fn = fakeFetch(200, project);
    await fetchProject("C:/loja", ["dados/grande.py"]);
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      path: "C:/loja",
      include: ["dados/grande.py"],
    });
  });

  it("returns not-found with the typed path on 404", async () => {
    fakeFetch(404, { error: "not-found", path: "./nao/existe" });
    expect(await fetchProject("./nao/existe")).toEqual({
      error: "not-found",
      path: "./nao/existe",
    });
  });

  it.each([400, 500])("rejects with the HTTP code on %i", async (status) => {
    fakeFetch(status, { error: "x" });
    await expect(fetchProject("C:/loja")).rejects.toThrow(
      `Falha ao abrir a pasta (HTTP ${status})`,
    );
  });
});

const ok = {
  status: "ok",
  result: { summary: "Calcula o frete." },
  fromCache: false,
  review: "full",
};

describe.each([
  ["summary", fetchSummary],
  ["suggestions", fetchSuggestions],
] as const)(
  "fetch of the %s part (CFG-01, CFG-02, CFG-05)",
  (part, fetchPart) => {
    it("posts { source, nodeId } to its own route and returns ok as received", async () => {
      const fn = fakeFetch(200, ok);
      const result = await fetchPart({ source: "src" }, "f");
      const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`/api/${part}`);
      expect(JSON.parse(init.body as string)).toEqual({
        source: "src",
        nodeId: "f",
      });
      expect(result).toEqual(ok);
    });

    it("sends cachedOnly: true only when asked, and returns not-cached as received", async () => {
      const fn = fakeFetch(200, { status: "not-cached" });
      expect(await fetchPart({ root: "C:/loja" }, "n", true)).toEqual({
        status: "not-cached",
      });
      const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        root: "C:/loja",
        nodeId: "n",
        cachedOnly: true,
      });
    });

    it("returns no-key and unfaithful as received (FID-10)", async () => {
      fakeFetch(200, { status: "no-key" });
      expect(await fetchPart({ source: "s" }, "f")).toEqual({
        status: "no-key",
      });
      fakeFetch(200, { status: "unfaithful" });
      expect(await fetchPart({ source: "s" }, "f")).toEqual({
        status: "unfaithful",
      });
    });

    it("maps 502 and a network failure to status error (CORE-20)", async () => {
      fakeFetch(502, { status: "error", message: "boom" });
      expect(await fetchPart({ source: "s" }, "f")).toEqual({
        status: "error",
        message: "boom",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("network down");
        }),
      );
      expect((await fetchPart({ source: "s" }, "f")).status).toBe("error");
    });

    it("maps 404 to status stale", async () => {
      fakeFetch(404, { error: "not found" });
      expect(await fetchPart({ source: "s" }, "gone")).toEqual({
        status: "stale",
      });
    });
  },
);

describe("settings (CFG-12, CFG-13, CFG-21)", () => {
  const view: SettingsResponse = {
    provider: "openrouter",
    model: "m/x",
    autoSummary: false,
    autoSuggestions: true,
    hasKey: true,
    providers: [{ id: "openrouter", defaultModel: "m/x", usesKey: true }],
    env: {},
  };

  it("fetchSettings gets /api/settings and returns the view", async () => {
    const fn = fakeFetch(200, view);
    expect(await fetchSettings()).toEqual(view);
    const [url] = fn.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/settings");
  });

  it("fetchSettings gives null on an HTTP error or a network failure", async () => {
    fakeFetch(500, {});
    expect(await fetchSettings()).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    expect(await fetchSettings()).toBeNull();
  });

  it("saveSettings puts the patch as JSON and returns the new view", async () => {
    const fn = fakeFetch(200, view);
    expect(await saveSettings({ apiKey: "k", autoSummary: true })).toEqual(
      view,
    );
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/settings");
    expect(init.method).toBe("PUT");
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      apiKey: "k",
      autoSummary: true,
    });
  });

  it("saveSettings gives null on 400", async () => {
    fakeFetch(400, { error: "invalid settings" });
    expect(await saveSettings({ model: "--x" })).toBeNull();
  });
});

describe("fetchTitles (VID-14, VID-15)", () => {
  const titles: NodeTitle[] = [
    {
      nodeId: "fn:calcular_frete",
      text: "Calcular frete",
      lines: [17],
      fromCache: false,
    },
  ];
  const ids = ["fn:calcular_frete", "fn:calcular_frete/s0"];

  it("posts { source, nodeIds } as JSON to /api/titles and returns the titles on ok", async () => {
    const fn = fakeFetch(200, { status: "ok", titles });
    const result = await fetchTitles({ source: "x = 1" }, ids);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/titles");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      source: "x = 1",
      nodeIds: ids,
    });
    expect(result).toEqual(titles);
  });

  it("posts { root, nodeIds } for a project", async () => {
    const fn = fakeFetch(200, { status: "ok", titles: [] });
    await fetchTitles({ root: "C:/loja" }, ["file:a.py/fn:f"]);
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      root: "C:/loja",
      nodeIds: ["file:a.py/fn:f"],
    });
  });

  it("returns the cached titles of no-key", async () => {
    fakeFetch(200, { status: "no-key", titles });
    expect(await fetchTitles({ source: "x" }, ids)).toEqual(titles);
  });

  it("returns the cached titles of error", async () => {
    fakeFetch(200, { status: "error", message: "falhou", titles });
    expect(await fetchTitles({ source: "x" }, ids)).toEqual(titles);
  });

  it("returns [] for error and no-key without titles", async () => {
    fakeFetch(200, { status: "error", message: "falhou", titles: [] });
    expect(await fetchTitles({ source: "x" }, ids)).toEqual([]);
    fakeFetch(200, { status: "no-key", titles: [] });
    expect(await fetchTitles({ source: "x" }, ids)).toEqual([]);
  });

  it.each([400, 404, 500])("returns [] on HTTP %i", async (status) => {
    fakeFetch(status, { status: "ok", titles });
    expect(await fetchTitles({ source: "x" }, ids)).toEqual([]);
  });

  it("returns [] when the network fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await fetchTitles({ source: "x" }, ids)).toEqual([]);
  });
});

describe("session token on every call (DIST-19)", () => {
  // Every api function, called once; the answer only has to parse.
  const calls: [string, () => Promise<unknown>][] = [
    ["fetchGraph", () => fetchGraph("x")],
    ["fetchLanguages", () => fetchLanguages()],
    ["fetchProject", () => fetchProject("C:/p")],
    ["fetchSummary", () => fetchSummary({ source: "x" }, "n")],
    ["fetchSuggestions", () => fetchSuggestions({ source: "x" }, "n")],
    ["fetchSettings", () => fetchSettings()],
    ["saveSettings", () => saveSettings({ autoSummary: true })],
    ["fetchTitles", () => fetchTitles({ source: "x" }, ["n"])],
    ["fetchHistory", () => fetchHistory()],
    ["fetchHistoryEntry", () => fetchHistoryEntry(1)],
    ["deleteHistory", () => deleteHistory(1)],
    ["starHistory", () => starHistory(1, true)],
  ];
  const sentHeader = (fn: ReturnType<typeof fakeFetch>) => {
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit?];
    return new Headers(init?.headers).get("x-8n8-token");
  };

  it.each(calls)("%s sends x-8n8-token", async (_name, call) => {
    setSessionToken("tok-123");
    const fn = fakeFetch(200, { items: [], entry: {}, languages: [] });
    await call().catch(() => undefined);
    expect(sentHeader(fn)).toBe("tok-123");
  });

  it.each(calls)(
    "%s sends no token header without a session",
    async (_name, call) => {
      const fn = fakeFetch(200, { items: [], entry: {}, languages: [] });
      await call().catch(() => undefined);
      expect(sentHeader(fn)).toBeNull();
    },
  );
});
