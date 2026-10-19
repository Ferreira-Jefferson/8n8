// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the strings are TypeScript sources under test
import type { SourceFile } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { typescriptPlugin } from "../index";
import { expectWellFormed, lines, node } from "./helpers";
import { lojaFiles } from "./loja";

const analyze = (files: Record<string, string>) =>
  typescriptPlugin.analyze(
    Object.entries(files).map(
      ([path, source]): SourceFile => ({ path, source }),
    ),
  );

const importPairs = (files: Record<string, string>) =>
  analyze(files).imports.map((e) => `${e.source} -> ${e.target}`);

describe("analyze: one graph per file", () => {
  const loja = lojaFiles();
  const result = typescriptPlugin.analyze(loja);

  it("gives one graph per file, sorted by path, each starting with its file node", () => {
    expect(result.files.map((f) => f.path)).toEqual([
      "frete/calculo.ts",
      "main.ts",
      "pedidos/index.ts",
      "pedidos/itens.ts",
      "pedidos/pedidos.ts",
      "server.ts",
      "ui.tsx",
    ]);
    for (const { path, graph } of result.files) {
      const [head, ...inner] = graph.nodes;
      expect(head).toMatchObject({
        id: `file:${path}`,
        kind: "file",
        path,
        openable: true,
      });
      expect(inner.every((n) => n.id.startsWith(`file:${path}/`))).toBe(true);
      expect(graph.language).toBe("typescript");
    }
  });

  it("is well formed, with the file node covering every line", () => {
    for (const file of loja) {
      const graph = result.files.find((f) => f.path === file.path)?.graph;
      if (!graph) throw new Error(file.path);
      expectWellFormed(graph, lines(file.source), { partial: true });
      expect(graph.nodes[0]?.range).toEqual({
        start: 1,
        end: lines(file.source),
      });
    }
  });

  it("parents a file to its folder, or to nothing at the root", () => {
    const parent = (path: string) =>
      result.files.find((f) => f.path === path)?.graph.nodes[0]?.parentId;

    expect(parent("main.ts")).toBeNull();
    expect(parent("frete/calculo.ts")).toBe("dir:frete");
  });

  it("reads .tsx files with the TSX grammar", () => {
    const ui = result.files.find((f) => f.path === "ui.tsx")?.graph;

    expect(ui?.nodes.some((n) => n.syntaxError)).toBe(false);
  });

  it("resolves calls across files to `file:<path>/fn:<name>`", () => {
    const main = result.files.find((f) => f.path === "main.ts")?.graph;
    if (!main) throw new Error("main.ts");

    expect(node(main, "file:main.ts/fn:main/s0").target).toBe(
      "file:pedidos/pedidos.ts/fn:criarPedido",
    ); // named re-export through pedidos/index.ts
    expect(node(main, "file:main.ts/fn:main/s1").target).toBe(
      "file:pedidos/itens.ts/fn:somar",
    ); // `export *`
    expect(node(main, "file:main.ts/fn:main/s2")).toMatchObject({
      label: "frete.calcularFrete",
      target: "file:frete/calculo.ts/fn:calcularFrete",
    }); // namespace import, `.js` for `.ts`
    expect(node(main, "file:main.ts/fn:main/s3").target).toBe(
      "file:frete/calculo.ts/fn:tabela",
    ); // default import
    expect(
      main.edges.filter((e) => e.kind === "calls").map((e) => e.target),
    ).toEqual([
      "file:pedidos/pedidos.ts/fn:criarPedido",
      "file:pedidos/itens.ts/fn:somar",
      "file:frete/calculo.ts/fn:calcularFrete",
      "file:frete/calculo.ts/fn:tabela",
    ]);
  });

  it("is the same for the same files, in any order", () => {
    const again = typescriptPlugin.analyze([...loja].reverse());

    expect(again).toEqual(result);
    expect(JSON.stringify(result, null, 2)).toMatchSnapshot();
  });

  it("marks a syntax error on the file node when it is outside any node", () => {
    const { files } = analyze({ "a.ts": "const a = 1;\n)\n" });
    const graph = files[0]?.graph;

    expect(graph?.nodes.find((n) => n.syntaxError)?.syntaxError).toEqual({
      line: 2,
    });
  });

  it("keeps the functions after a broken one, and marks the error on the file node", () => {
    const { files } = analyze({
      "broken.ts":
        "export function ok() {\n  return 1;\n}\nexport function bad( {\n  return 2\n}\nexport function after() {\n  return ok();\n}\n",
    });
    const nodes = files[0]?.graph.nodes ?? [];

    expect(nodes.filter((n) => n.kind === "function").map((n) => n.id)).toEqual(
      ["file:broken.ts/fn:ok", "file:broken.ts/fn:after"],
    );
    expect(nodes[0]?.syntaxError).toEqual({ line: 4 });
    expect(nodes.filter((n) => n.syntaxError)).toHaveLength(1);
  });

  it("analyzes no files", () => {
    expect(analyze({})).toEqual({
      files: [],
      imports: [],
      offers: [],
      requests: [],
    });
  });
});

describe("analyze: imports between files", () => {
  const imports = importPairs(
    Object.fromEntries(lojaFiles().map((f) => [f.path, f.source])),
  );

  it("wires every form of import of the fixture", () => {
    expect(imports).toEqual([
      "file:main.ts -> file:frete/calculo.ts",
      "file:main.ts -> file:pedidos/index.ts",
      "file:pedidos/index.ts -> file:pedidos/itens.ts",
      "file:pedidos/index.ts -> file:pedidos/pedidos.ts",
      "file:pedidos/pedidos.ts -> file:frete/calculo.ts",
      "file:server.ts -> file:main.ts",
      "file:ui.tsx -> file:main.ts",
    ]);
  });

  it("gives `imports` wires with a stable id", () => {
    const edge = analyze({ "a.ts": 'import "./b";', "b.ts": "" }).imports[0];

    expect(edge).toEqual({
      id: "imports:file:a.ts->file:b.ts",
      kind: "imports",
      source: "file:a.ts",
      target: "file:b.ts",
    });
  });

  it.each([
    ["import x from './b'", "b.ts"],
    ["import { x } from './b'", "b.ts"],
    ["import * as x from './b'", "b.ts"],
    ["import type { X } from './b'", "b.ts"],
    ["import './b'", "b.ts"],
    ["export { x } from './b'", "b.ts"],
    ["export * from './b'", "b.ts"],
    ["const x = require('./b')", "b.ts"],
    ["const x = await import('./b')", "b.ts"],
    ["import x from './b.js'", "b.ts"],
    ["import x from './b.ts'", "b.ts"],
    ["import x from './pasta'", "pasta/index.ts"],
    ["import x from './tela'", "tela.tsx"],
    ["import x from './pasta2'", "pasta2/index.tsx"],
  ])("wires `%s` to %s", (code, target) => {
    const result = analyze({
      "a.ts": `${code};\n`,
      "b.ts": "",
      "pasta/index.ts": "",
      "pasta2/index.tsx": "",
      "tela.tsx": "",
    });

    expect(result.imports.map((e) => e.target)).toEqual([`file:${target}`]);
  });

  it("resolves `../` and `./` from the folder of the file", () => {
    expect(
      importPairs({
        "src/a/x.ts": "import '../b/y'; import './z';",
        "src/b/y.ts": "",
        "src/a/z.ts": "",
      }),
    ).toEqual([
      "file:src/a/x.ts -> file:src/b/y.ts",
      "file:src/a/x.ts -> file:src/a/z.ts",
    ]);
  });

  it("gives one wire per pair of files, however many imports", () => {
    expect(
      importPairs({
        "a.ts": "import './b'; import {x} from './b.js';",
        "b.ts": "",
      }),
    ).toEqual(["file:a.ts -> file:b.ts"]);
  });

  it("gives no wire for a package, a missing file, a path above the root or the file itself", () => {
    expect(
      importPairs({
        "a.ts":
          "import 'react'; import './nada'; import '../fora'; import './a'; import 'node:fs';",
      }),
    ).toEqual([]);
  });
});

describe("analyze: requests", () => {
  const requests = (source: string, extra: Record<string, string> = {}) =>
    analyze({ "a.ts": source, ...extra }).requests.map((r) => [
      r.channel,
      r.key,
      r.nodeId,
      r.line,
    ]);

  describe("http", () => {
    it("reads fetch with a method, and defaults to GET", () => {
      expect(
        requests(
          [
            "function f() {",
            "  fetch('https://api.exemplo.com/frete?x=1', { method: 'post' });",
            "  fetch('/api/lista');",
            "  fetch('/api/any', { method });",
            "  fetch('/api/dyn', { method: m });",
            "}",
          ].join("\n"),
        ),
      ).toEqual([
        ["http", "POST /frete", "file:a.ts/fn:f/s0", 2],
        ["http", "GET /api/lista", "file:a.ts/fn:f/s1", 3],
        ["http", "* /api/any", "file:a.ts/fn:f/s2", 4],
        ["http", "* /api/dyn", "file:a.ts/fn:f/s3", 5],
      ]);
    });

    it("keeps the path of an absolute URL, `/` for a bare host", () => {
      expect(
        requests("fetch('http://localhost:3000');\nfetch('https://h.com/');"),
      ).toEqual([
        ["http", "GET /", "file:a.ts/mod/s0", 1],
        ["http", "GET /", "file:a.ts/mod/s1", 2],
      ]);
    });

    it("reads axios verbs and a config object", () => {
      expect(
        requests(
          [
            "import axios from 'axios';",
            "axios.get('/a');",
            "axios.post('/b', {});",
            "axios.delete('/c');",
            "axios({ url: '/d', method: 'put' });",
            "axios('/e');",
          ].join("\n"),
        ).map(([, key]) => key),
      ).toEqual(["GET /a", "POST /b", "DELETE /c", "PUT /d", "GET /e"]);
    });

    it("reads got", () => {
      expect(
        requests(
          "import got from 'got';\ngot.post('/a');\ngot('/b', { method: 'PATCH' });",
        ).map(([, key]) => key),
      ).toEqual(["POST /a", "PATCH /b"]);
    });

    it("reads a template with holes and a + chain, and drops a leading host variable", () => {
      expect(
        requests(
          [
            "fetch(`${BASE}/api/frete/${id}`);",
            "fetch('/api/pedidos/' + id + '/itens');",
            "fetch(`/api/q/${a}/${b}`);",
          ].join("\n"),
        ).map(([, key]) => key),
      ).toEqual([
        "GET /api/frete/:param",
        "GET /api/pedidos/:param/itens",
        "GET /api/q/:param/:param",
      ]);
    });

    it("keeps the code of a URL base or host known only at run time, and nothing for a literal one", () => {
      const bases = analyze({
        "a.ts": [
          "fetch(`${config.baseUrl}/users/${id}`);",
          "fetch(process.env.API_URL + '/users');",
          "fetch(`https://${host}/users`);",
          "fetch((cfg.base) + '/users');",
          "fetch('/users');",
          "fetch(`/users/${id}`);",
          "fetch('https://api.x.com/users');",
        ].join("\n"),
      }).requests.map((r) => [r.key, r.dynamicBase]);
      expect(bases).toEqual([
        ["GET /users/:param", "config.baseUrl"],
        ["GET /users", "process.env.API_URL"],
        ["GET /users", "host"],
        ["GET /users", "cfg.base"],
        ["GET /users", undefined],
        ["GET /users/:param", undefined],
        ["GET /users", undefined],
      ]);
    });

    it("skips a URL that is not a path or is not text", () => {
      expect(
        requests(
          [
            "fetch(url);",
            "fetch(`${base}`);",
            "fetch('data.json');",
            "fetch();",
            "axios.get(cfg);",
            "fetch((a));",
            "fetch(1 - 2);",
          ].join("\n"),
        ).filter(([channel]) => channel === "http"),
      ).toEqual([]);
    });

    it("does not read a fetch or axios the file defines or a method on another receiver", () => {
      expect(
        requests(
          "function fetch(u) {}\nfetch('/a');\nclient.get('/b');\nconst axios = 1;\naxios.get('/c');",
        ).filter(([channel]) => channel === "http"),
      ).toEqual([]);
    });

    it("reads a client of axios or got with its base: a literal path adds, a host or a run-time value is to check", () => {
      const keys = analyze({
        "a.ts": [
          "import axios from 'axios';",
          "import got from 'got';",
          "const api = axios.create({ baseURL: '/api' });",
          "const ext = axios.create({ baseURL: 'https://backend.example.com/v1' });",
          "const env = axios.create({ baseURL: process.env.API });",
          "const bare = axios.create();",
          "const g = got.extend({ prefixUrl: '/g/' });",
          "api.get('/users');",
          "api.post('users', u);",
          "ext.delete(`/users/${id}`);",
          "env.get('/a');",
          "bare.put('/b');",
          "g.get('c');",
          "api('/d');",
          "api({ url: '/e', method: 'patch' });",
          "api.get('https://other.com/x');",
          "api.get(id);",
        ].join("\n"),
      }).requests.flatMap((r) =>
        r.channel === "http" ? [[r.key, r.dynamicBase, r.line]] : [],
      );
      expect(keys).toEqual([
        ["GET /api/users", undefined, 8],
        ["POST /api/users", undefined, 9],
        ["DELETE /v1/users/:param", "'https://backend.example.com/v1'", 10],
        ["GET /a", "process.env.API", 11],
        ["PUT /b", undefined, 12],
        ["GET /g/c", undefined, 13],
        ["GET /api/d", undefined, 14],
        ["PATCH /api/e", undefined, 15],
        ["GET /x", undefined, 16],
      ]);
    });

    it("reads a call of a function that wraps a request, with the method of the function or of its options", () => {
      const keys = analyze({
        "a.ts": [
          "function apiFetch(url: string, init: RequestInit = {}) {",
          "  return fetch(url, { ...init, headers: {} });",
          "}",
          "function post(url, body) {",
          "  return apiFetch(url, { method: 'POST', body: JSON.stringify(body) });",
          "}",
          "const del = (path) => fetch(`/api${path}`, { method: 'DELETE' });",
          "export const get = async (u) => (await fetch('/v1' + u)).json();",
          "function load() {",
          "  post('/api/project', x);",
          "  apiFetch('/api/languages');",
          "  apiFetch(`/api/history/${id}`, { method: 'PUT' });",
          "  del('/items');",
          "  get(`/a/${id}`);",
          "  post(path, x);",
          "  user(id);",
          "}",
          "const user = (id) => fetch(`/users/${id}`);",
        ].join("\n"),
      }).requests.flatMap((r) =>
        r.channel === "http" ? [[r.key, r.line]] : [],
      );
      // The request inside a wrapper stays where it is when its URL has text; a call whose argument has none
      // (`user(id)`) is not one more request.
      expect(keys).toEqual([
        ["DELETE /api:param", 7],
        ["GET /v1:param", 8],
        ["POST /api/project", 10],
        ["GET /api/languages", 11],
        ["PUT /api/history/:param", 12],
        ["DELETE /api/items", 13],
        ["GET /v1/a/:param", 14],
        ["GET /users/:param", 18],
      ]);
    });

    it("follows a client or a wrapper imported from another file of the project", () => {
      const result = analyze({
        "http.ts": [
          "import axios from 'axios';",
          "export const api = axios.create({ baseURL: '/api' });",
          "export function post(url, body) {",
          "  return fetch(url, { method: 'POST', body });",
          "}",
          "export default api;",
        ].join("\n"),
        "a.ts": [
          "import { api, post as enviar } from './http';",
          "import client from './http';",
          "api.get('/users');",
          "enviar('/x', 1);",
          "client.delete('/y');",
          "api.post('/z', data);",
        ].join("\n"),
      });
      expect(
        result.requests.flatMap((r) =>
          r.channel === "http" ? [[r.key, r.nodeId]] : [],
        ),
      ).toEqual([
        ["GET /api/users", "file:a.ts/mod/s0"],
        ["POST /x", "file:a.ts/mod/s1"],
        ["DELETE /api/y", "file:a.ts/mod/s2"],
        // A call to a name of the project is plain code: the two lines share one step.
        ["POST /api/z", "file:a.ts/mod/s2"],
      ]);
      expect(result.offers.filter((o) => o.channel === "http")).toEqual([]);
    });

    it("reads node-fetch under any local name", () => {
      expect(
        requests("import nf from 'node-fetch';\nnf('/a');").filter(
          ([channel]) => channel === "http",
        ),
      ).toEqual([["http", "GET /a", "file:a.ts/mod/s0", 2]]);
    });

    it("reads a call nested in a statement, on its own line", () => {
      expect(
        requests(
          "function f() {\n  const r = [\n    1,\n    fetch('/a'),\n  ];\n}\n",
        ).map((r) => r[3]),
      ).toEqual([4]);
    });
  });

  describe("process", () => {
    it.each([
      ["exec('node b.ts')", "b.ts"],
      [
        "execSync('python ./scripts/relatorio.py --x')",
        "./scripts/relatorio.py",
      ],
      ["spawn('python', ['a.py', '--flag'])", "a.py"],
      ["spawnSync('node', ['--experimental', 'dir/c.mjs'])", "dir/c.mjs"],
      ["fork('./worker.js')", "./worker.js"],
      ["execFile('./bin/run.sh')", "./bin/run.sh"],
      ["execFileSync('bash', ['x.sh'])", "x.sh"],
      ["exec(`node ${dir}/d.js`)", undefined],
      ["exec('ls -la')", undefined],
      ["exec('npm run build')", undefined],
      ["exec('curl https://x.com/a.js')", undefined],
      ["exec(cmd)", undefined],
    ])("reads `%s`", (call, key) => {
      const found = requests(
        `import { exec, execSync, spawn, spawnSync, fork, execFile, execFileSync } from "node:child_process";\n${call};`,
      ).filter(([channel]) => channel === "process");

      expect(found.map(([, k]) => k)).toEqual(key === undefined ? [] : [key]);
      if (key !== undefined) expect(found[0]?.[3]).toBe(2);
    });

    it("reads a default or namespace import and an aliased one", () => {
      const key = (header: string, call: string) =>
        requests(`${header}\n${call};`)
          .filter(([channel]) => channel === "process")
          .map(([, k]) => k);

      expect(
        key("import cp from 'child_process';", "cp.exec('node a.js')"),
      ).toEqual(["a.js"]);
      expect(
        key(
          "import * as cp from 'node:child_process';",
          "cp.spawn('python', ['b.py'])",
        ),
      ).toEqual(["b.py"]);
      expect(
        key("import { exec as run } from 'child_process';", "run('node c.js')"),
      ).toEqual(["c.js"]);
      expect(
        key("const cp = require('child_process');", "cp.exec('node d.js')"),
      ).toEqual(["d.js"]);
      expect(
        key("const { fork } = require('child_process');", "fork('e.js')"),
      ).toEqual(["e.js"]);
    });

    it("does not read exec from somewhere else", () => {
      expect(
        requests("import { exec } from 'my-lib';\nexec('node a.js');").filter(
          ([channel]) => channel === "process",
        ),
      ).toEqual([]);
    });
  });

  describe("name", () => {
    it("asks for a name the file neither defines nor imports", () => {
      expect(
        requests(
          "function f() {\n  notificar(1);\n  notificar(2);\n}\nfunction g() { notificar(3); }",
        ).filter(([channel]) => channel === "name"),
      ).toEqual([
        ["name", "notificar", "file:a.ts/fn:f/s0", 2],
        ["name", "notificar", "file:a.ts/fn:f/s1", 3],
        ["name", "notificar", "file:a.ts/fn:g/s0", 5],
      ]);
    });

    it("does not ask for defined, imported, bound, ambient or known names", () => {
      expect(
        requests(
          [
            "import { a } from './x';",
            "import b from 'b';",
            "function c() {}",
            "const d = () => 1;",
            "function f(e) {",
            "  a(); b(); c(); d(); e();",
            "  setTimeout(a, 1); parseInt('1'); require('x'); fetch('/x'); readFileSync('x');",
            "  obj.method(); (() => 1)();",
            "}",
          ].join("\n"),
        ).filter(([channel]) => channel === "name"),
      ).toEqual([]);
    });

    it("does not ask for a method call", () => {
      expect(
        requests("lib.go();").filter(([channel]) => channel === "name"),
      ).toEqual([]);
    });
  });
});

describe("analyze: offers", () => {
  const offers = (source: string, path = "a.ts") =>
    analyze({ [path]: source }).offers.map((o) => [
      o.channel,
      o.key,
      o.nodeId,
      o.line,
    ]);
  const byChannel = (list: unknown[][], channel: string) =>
    list.filter(([c]) => c === channel);

  describe("http", () => {
    it("offers a route of Express, Hono or Fastify", () => {
      expect(
        byChannel(
          offers(
            [
              "app.get('/api/a', (req, res) => {});",
              "router.post('/api/b', handler);",
              "fastify.put('/api/c', async () => {});",
              "api.delete('/api/d', h);",
              "userRouter.patch('/api/e', h);",
              "app.all('/api/f', h);",
              "server.options('/api/g', h);",
              "app.head('/api/h', h);",
              "function handler() {}",
            ].join("\n"),
          ),
          "http",
        ).map(([, key, , line]) => [key, line]),
      ).toEqual([
        ["GET /api/a", 1],
        ["POST /api/b", 2],
        ["PUT /api/c", 3],
        ["DELETE /api/d", 4],
        ["PATCH /api/e", 5],
        ["* /api/f", 6],
        ["OPTIONS /api/g", 7],
        ["HEAD /api/h", 8],
      ]);
    });

    it("points the offer at the handler when it is a function of the file, else at the step", () => {
      expect(
        byChannel(
          offers(
            "function handler() {}\napp.get('/a', handler);\napp.get('/b', (c) => c);\napp.get('/c', other);",
          ),
          "http",
        ).map(([, , nodeId]) => nodeId),
      ).toEqual([
        "file:a.ts/fn:handler",
        "file:a.ts/mod/s1",
        "file:a.ts/mod/s2",
      ]);
    });

    it("does not offer a settings getter, a client call or a path without `/`", () => {
      expect(
        byChannel(
          offers(
            "app.get('title');\naxios.get('/a', {});\napp.get('a', h);\napp.use('/x', h);\napp.get(path, h);\napp.get('/y');\napp.listen('/z', h);",
          ),
          "http",
        ),
      ).toEqual([]);
    });

    it("offers a route under the prefix where its router is mounted, or its basePath", () => {
      expect(
        byChannel(
          offers(
            [
              "import express from 'express';",
              "import { Hono } from 'hono';",
              "const app = express();",
              "const users = express.Router();",
              "users.get('/users', h);",
              "users.get('/', h);",
              "app.use('/api', users);",
              "const items = new Hono();",
              "items.post('/items', (c) => c.json(1));",
              "const web = new Hono().basePath('/web');",
              "web.route('/v1', items);",
              "const v2 = web.basePath('/v2');",
              "v2.get('/z', h);",
              "app.get('/health', h);",
            ].join("\n"),
          ),
          "http",
        ).map(([, key, , line]) => [key, line]),
      ).toEqual([
        ["GET /api/users", 5],
        ["GET /api", 6],
        ["POST /web/v1/items", 9],
        ["GET /web/v2/z", 13],
        ["GET /health", 14],
      ]);
    });

    it("offers a route of a router mounted in another file under that prefix only", () => {
      const result = analyze({
        "routes/users.ts": [
          "import { Router } from 'express';",
          "const router = Router();",
          "router.get('/users/:id', h);",
          "export default router;",
        ].join("\n"),
        "routes/items.ts": [
          "import { Hono } from 'hono';",
          "export const items = new Hono();",
          "items.get('/items', (c) => c.json(1));",
        ].join("\n"),
        "server.ts": [
          "import express from 'express';",
          "import { Hono } from 'hono';",
          "import users from './routes/users';",
          "import { items } from './routes/items';",
          "const app = express();",
          "app.use('/api', auth, users);",
          "const hono = new Hono().basePath('/h');",
          "hono.route('/v1', items);",
        ].join("\n"),
      });
      expect(
        result.offers.flatMap((o) =>
          o.channel === "http" ? [[o.key, o.nodeId]] : [],
        ),
      ).toEqual([
        ["GET /h/v1/items", "file:routes/items.ts/mod/s1"],
        ["GET /api/users/:id", "file:routes/users.ts/mod/s1"],
      ]);
    });

    it("does not offer a call on a client of axios, got or ky, or one whose last argument is data", () => {
      expect(
        byChannel(
          offers(
            [
              "import axios from 'axios';",
              "import got from 'got';",
              "import ky from 'ky';",
              "const api = axios.create({ baseURL: 'https://backend.example.com' });",
              "const server = got.extend({ prefixUrl: 'https://x.com' });",
              "const routes = ky.create({ prefixUrl: 'https://x.com' });",
              "const body = { name: 'a' };",
              "api.post('/users', u);",
              "server.get('/a', h);",
              "routes.put('/b', h);",
              "app.post('/c', { name: 'a' });",
              "app.post('/d', 'text');",
              "app.post('/e', body);",
              "app.post('/f', [1]);",
              "app.post('/g', asyncHandler(h));",
              "app.post('/h', handlers.save);",
              "app.post('/i', function (req, res) {});",
            ].join("\n"),
          ),
          "http",
        ).map(([, key]) => key),
      ).toEqual(["POST /g", "POST /h", "POST /i"]);
    });
  });

  describe("process", () => {
    it("offers the path of the file itself", () => {
      expect(byChannel(offers("", "src/b.ts"), "process")).toEqual([
        ["process", "src/b.ts", "file:src/b.ts", 1],
      ]);
    });
  });

  describe("name", () => {
    it("offers each exported top-level function by its exported name", () => {
      expect(
        byChannel(
          offers(
            [
              "export function a() {}",
              "export const b = () => 1;",
              "function c() {}",
              "function d() {}",
              "export { c, d as e };",
              "export default function f() {}",
              "export class K {}",
              "export const n = 1;",
            ].join("\n"),
          ),
          "name",
        ).map(([, key, nodeId, line]) => [key, nodeId, line]),
      ).toEqual([
        ["a", "file:a.ts/fn:a", 1],
        ["b", "file:a.ts/fn:b", 2],
        ["c", "file:a.ts/fn:c", 3],
        ["e", "file:a.ts/fn:d", 4],
        ["f", "file:a.ts/fn:f", 6],
      ]);
    });

    it("does not offer a function that is not exported, or an anonymous default", () => {
      expect(
        byChannel(offers("function a() {}\nexport default () => 1;"), "name"),
      ).toEqual([]);
    });
  });

  it("gives offers and requests the real node and line of the fixture", () => {
    const { offers: all, requests: asked } = typescriptPlugin.analyze(
      lojaFiles(),
    );

    expect(all.filter((o) => o.channel === "http")).toEqual([
      {
        channel: "http",
        key: "GET /api/frete",
        nodeId: "file:server.ts/fn:handler",
        line: 11,
      },
      {
        channel: "http",
        key: "POST /api/pedidos",
        nodeId: "file:server.ts/mod/s1",
        line: 12,
      },
    ]);
    expect(asked).toEqual([
      {
        channel: "http",
        key: "POST /api/frete",
        nodeId: "file:pedidos/pedidos.ts/fn:criarPedido/s2",
        line: 13,
      },
      {
        channel: "name",
        key: "notificar",
        nodeId: "file:server.ts/mod/s1",
        line: 13,
      },
      {
        channel: "process",
        key: "relatorio.py",
        nodeId: "file:server.ts/mod/s2",
        line: 17,
      },
      {
        channel: "http",
        key: "GET /api/frete",
        nodeId: "file:ui.tsx/fn:Tela/s0",
        line: 5,
        dynamicBase: "BASE",
      },
    ]);
  });
});

describe("analyze: calls across files", () => {
  /** The target of the first step of `function g` in `main.ts`. */
  const targetOf = (
    header: string,
    call: string,
    extra: Record<string, string>,
  ) => {
    const { files } = analyze({
      "main.ts": `${header}\nfunction g() {\n  ${call};\n}\n`,
      ...extra,
    });
    const main = files.find((f) => f.path === "main.ts")?.graph;
    return main?.nodes.find((n) => n.id === "file:main.ts/fn:g/s0")?.target;
  };

  it("follows `export default name`, `export { name as default }` and a default function", () => {
    const a = "file:a.ts/fn:foo";

    expect(
      targetOf('import f from "./a";', "f()", {
        "a.ts": "function foo() {}\nexport default foo;\n",
      }),
    ).toBe(a);
    expect(
      targetOf('import f from "./a";', "f()", {
        "a.ts": "function foo() {}\nexport { foo as default };\n",
      }),
    ).toBe(a);
    expect(
      targetOf('import f from "./a";', "f()", {
        "a.ts": "export default function foo() {}\n",
      }),
    ).toBe(a);
    expect(
      targetOf('import f from "./a";', "f()", {
        "a.ts": "export default () => 1;\n",
      }),
    ).toBe("file:a.ts/fn:default");
  });

  it("follows an alias on import and on export", () => {
    expect(
      targetOf('import { novo as n } from "./a";', "n()", {
        "a.ts": "function velho() {}\nexport { velho as novo };\n",
      }),
    ).toBe("file:a.ts/fn:velho");
  });

  it("follows `export { a as b } from` and `export * from`, through more than one file", () => {
    const files = {
      "a.ts": "export function fa() {}\n",
      "b.ts": 'export { fa as fb } from "./a";\n',
      "c.ts": 'export * from "./b";\n',
    };

    expect(targetOf('import { fb } from "./c";', "fb()", files)).toBe(
      "file:a.ts/fn:fa",
    );
    expect(targetOf('import * as c from "./c";', "c.fb()", files)).toBe(
      "file:a.ts/fn:fa",
    );
  });

  it("does not loop on files that export each other", () => {
    const files = {
      "a.ts": 'export * from "./b";\n',
      "b.ts": 'export * from "./a";\n',
    };

    expect(targetOf('import { x } from "./a";', "x()", files)).toBeUndefined();
  });

  it("does not take `export * from` for the default export", () => {
    const files = {
      "a.ts": 'export * from "./b";\n',
      "b.ts": "export default function z() {}\n",
    };

    expect(targetOf('import d from "./a";', "d()", files)).toBeUndefined();
  });

  it("resolves a class by `new`, and a require of a project file", () => {
    expect(
      targetOf('import { Box } from "./a";', "new Box()", {
        "a.ts": "export class Box {}\n",
      }),
    ).toBe("file:a.ts/cls:Box");
    expect(
      targetOf('const { run: r } = require("./a");', "r()", {
        "a.ts": "export function run() {}\n",
      }),
    ).toBe("file:a.ts/fn:run");
    expect(
      targetOf('const a = require("./a");', "a.run()", {
        "a.ts": "export function run() {}\n",
      }),
    ).toBe("file:a.ts/fn:run");
  });

  it("still finds a name the file defines but does not export", () => {
    expect(
      targetOf('const a = require("./a");', "a.hidden()", {
        "a.ts": "function hidden() {}\n",
      }),
    ).toBe("file:a.ts/fn:hidden");
  });

  it("leaves a call to a package external, and a project call it cannot resolve as code", () => {
    const step = (header: string, call: string) => {
      const { files } = analyze({
        "main.ts": `${header}\nfunction g() {\n  ${call};\n}\n`,
        "a.ts": "export function run() {}\n",
      });
      return files[1]?.graph.nodes.find((n) => n.id === "file:main.ts/fn:g/s0");
    };

    expect(step('import { run } from "pacote";', "run()")).toMatchObject({
      kind: "external",
    });
    for (const [header, call] of [
      ['import { nada } from "./a";', "nada()"],
      ['import { run } from "./nao-existe";', "run()"],
      ['import * as a from "./a";', "a.x.y()"],
      ['import a from "./a";', "a.run()"],
    ] as const) {
      expect(step(header, call)).toMatchObject({ kind: "code" });
    }
  });
});

describe("analyze: failures", () => {
  it("parses a file with errors without throwing", () => {
    const result = analyze({
      "a.ts": "function (((\n",
      "b.ts": "export function ok() {}\n",
    });

    expect(result.files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(result.offers.some((o) => o.nodeId === "file:b.ts/fn:ok")).toBe(
      true,
    );
  });
});
