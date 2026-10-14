import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pythonPlugin } from "@code2n8n/lang-python";
import type {
  ExplainRequest,
  ProjectResponse,
  SourceFile,
} from "@code2n8n/model";
import { buildProject } from "@code2n8n/project";
import { describe, expect, it } from "vitest";
import { createApp, type ProjectRead } from "../app";
import { fakeLang } from "./fake-lang";

const response: ProjectResponse = {
  name: "loja",
  graph: { language: "python", empty: false, nodes: [], edges: [] },
  files: [{ path: "a.py", source: "x = 1\n" }],
  ignored: [{ path: "grande.py", reason: "too-large" }],
};

function setup(read: ProjectRead) {
  const paths: string[] = [];
  const app = createApp({
    plugins: [fakeLang(() => response.graph)],
    explain: async () => ({ status: "no-key" }),
    titles: async () => ({ status: "ok", titles: [] }),
    readProject: async (path) => {
      paths.push(path);
      return read;
    },
    port: 4317,
  });
  const post = (body: unknown, host = "127.0.0.1:4317") =>
    app.request("/api/project", {
      method: "POST",
      headers: { host, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { paths, post };
}

describe("POST /api/project", () => {
  it("returns { name, graph, files, ignored } from readProject, called with the typed path (PROJ-06)", async () => {
    const { paths, post } = setup({ kind: "ok", root: "/tmp/loja", response });
    const res = await post({ path: "./minha pasta/loja" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(response);
    expect(paths).toEqual(["./minha pasta/loja"]);
  });

  it("not-found becomes 404 { error, path } with the path as typed (PROJ-05)", async () => {
    const { post } = setup({ kind: "not-found" });
    const res = await post({ path: "./nao/existe" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "not-found",
      path: "./nao/existe",
    });
  });

  it("answers 400 to {}, an empty path and a non-string path", async () => {
    const { paths, post } = setup({ kind: "not-found" });
    for (const body of [{}, { path: "" }, { path: 42 }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid body" });
    }
    expect(paths).toEqual([]);
  });

  it("refuses a foreign Host with 403 and does not run readProject (PROJ-08)", async () => {
    const { paths, post } = setup({ kind: "ok", root: "/x", response });
    const res = await post({ path: "." }, "evil.example:4317");
    expect(res.status).toBe(403);
    expect(paths).toEqual([]);
  });
});

const fixtureDir = fileURLToPath(
  new URL(
    "../../../languages/python/src/__tests__/fixtures/projeto-loja",
    import.meta.url,
  ),
);

function readFixture(dir = ""): SourceFile[] {
  return readdirSync(join(fixtureDir, dir), { withFileTypes: true }).flatMap(
    (e) => {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      return e.isDirectory()
        ? readFixture(rel)
        : [{ path: rel, source: readFileSync(join(fixtureDir, rel), "utf8") }];
    },
  );
}

const WIN_ROOT = String.raw`C:\tmp\loja`;

function explainSetup(files: SourceFile[], root = WIN_ROOT) {
  const received: ExplainRequest[] = [];
  const app = createApp({
    plugins: [pythonPlugin],
    explain: async (req) => {
      received.push(req);
      return { status: "no-key" };
    },
    titles: async () => ({ status: "ok", titles: [] }),
    readProject: async (path) =>
      path === root
        ? {
            kind: "ok",
            root,
            response: {
              name: "loja",
              graph: buildProject(files, [pythonPlugin]),
              files,
              ignored: [],
            },
          }
        : { kind: "not-found" },
    port: 4317,
  });
  const post = (body: unknown) =>
    app.request("/api/explain", {
      method: "POST",
      headers: { host: "127.0.0.1:4317", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { received, post, root };
}

const calcular = "file:frete/calculo.py/fn:calcular_frete";

describe("POST /api/explain with { root, nodeId } (PROJ-07, PROJ-09, AD-015)", () => {
  it("builds the request from the file in the folder, with a scoped nodeId and qualified neighbours", async () => {
    const files = readFixture();
    const { received, post, root } = explainSetup(files);
    const res = await post({ root, nodeId: calcular });
    expect(res.status).toBe(200);
    const req = received[0];
    const lines = files
      .find((f) => f.path === "frete/calculo.py")
      ?.source.split("\n");
    expect(req?.nodeId).toBe(`C:/tmp/loja|${calcular}`);
    expect(req?.nodeName).toBe("calcular_frete");
    expect(req?.language).toBe("python");
    expect(req?.nodeKind).toBe("function");
    expect(req?.code).toBe(
      lines?.slice((req?.range.start ?? 1) - 1, req?.range.end).join("\n"),
    );
    expect(req?.code).toContain("def calcular_frete");
    expect(req?.calledBy).toEqual(["pedidos/pedidos.py:processar_pedido"]);
  });

  it("names a neighbour from the same file by its label only", async () => {
    const files: SourceFile[] = [
      {
        path: "a.py",
        source: "def g():\n    return 1\n\ndef f():\n    return g()\n",
      },
    ];
    const { received, post, root } = explainSetup(files);
    await post({ root, nodeId: "file:a.py/fn:f" });
    expect(received[0]?.calls).toEqual(["g"]);
    expect(received[0]?.code).toBe("def f():\n    return g()");
  });

  it("ignores extra client fields (code, source) next to root", async () => {
    const files = readFixture();
    const plain = explainSetup(files);
    await plain.post({ root: plain.root, nodeId: calcular });
    const extra = explainSetup(files);
    await extra.post({
      root: extra.root,
      nodeId: calcular,
      source: "def calcular_frete():\n    pass\n",
      code: "evil",
    });
    expect(plain.received).toHaveLength(1);
    expect(extra.received).toEqual(plain.received);
  });

  it("answers 404 when readProject says not-found and when the node is missing", async () => {
    const { received, post, root } = explainSetup(readFixture());
    expect(
      (await post({ root: String.raw`C:\outra`, nodeId: calcular })).status,
    ).toBe(404);
    expect((await post({ root, nodeId: "file:x.py/fn:nada" })).status).toBe(
      404,
    );
    expect(received).toEqual([]);
  });

  it("answers 400 for a folder node and a file node", async () => {
    const { received, post, root } = explainSetup(readFixture());
    expect((await post({ root, nodeId: "dir:frete" })).status).toBe(400);
    expect((await post({ root, nodeId: "file:frete/calculo.py" })).status).toBe(
      400,
    );
    expect(received).toEqual([]);
  });
});
