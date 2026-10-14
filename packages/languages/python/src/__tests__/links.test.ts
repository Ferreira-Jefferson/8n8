import { readFileSync } from "node:fs";
import type { LinkChannel, LinkRequest, Offer } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { pythonPlugin } from "../index";

/** Offers and requests of one file, as [channel, key, nodeId, line]. */
function linksOf(
  source: string,
  path = "app.py",
): { offers: Row[]; requests: Row[] } {
  const { offers, requests } = pythonPlugin.analyze([{ path, source }]);
  const row = (l: Offer | LinkRequest): Row => [
    l.channel,
    l.key,
    l.nodeId,
    l.line,
  ];
  return { offers: offers.map(row), requests: requests.map(row) };
}

type Row = [LinkChannel, string, string, number];

function only(rows: Row[], channel: LinkChannel): Row[] {
  return rows.filter((r) => r[0] === channel);
}

describe("requests: http", () => {
  it("takes the verb and the path of requests, httpx and aiohttp calls", () => {
    const { requests } = linksOf(
      [
        "import requests, httpx, aiohttp",
        "",
        "def f():",
        '    requests.get("https://api.x.com/frete?peso=3")',
        '    httpx.post("http://localhost:8000/pedidos")',
        '    aiohttp.delete("https://x.com")',
        '    requests.put("/relativo/a#topo")',
        "",
      ].join("\n"),
    );

    expect(only(requests, "http")).toEqual([
      ["http", "GET /frete", "file:app.py/fn:f/s0", 4],
      ["http", "POST /pedidos", "file:app.py/fn:f/s1", 5],
      ["http", "DELETE /", "file:app.py/fn:f/s2", 6],
      ["http", "PUT /relativo/a", "file:app.py/fn:f/s3", 7],
    ]);
  });

  it("follows import aliases and from-imports", () => {
    const { requests } = linksOf(
      [
        "import requests as r",
        "from httpx import get",
        "",
        "def f():",
        '    r.patch("https://x.com/a")',
        '    get("https://x.com/b")',
        "",
      ].join("\n"),
    );

    expect(only(requests, "http").map((r) => r[1])).toEqual([
      "PATCH /a",
      "GET /b",
    ]);
  });

  it("takes urllib calls with any method", () => {
    const { requests } = linksOf(
      [
        "import urllib.request",
        "",
        "def f():",
        '    urllib.request.urlopen("https://x.com/dados")',
        '    urllib.request.Request("https://x.com/outro")',
        '    urllib.request.urlretrieve("https://x.com/arquivo")',
        "",
      ].join("\n"),
    );

    expect(only(requests, "http").map((r) => r[1])).toEqual([
      "* /dados",
      "* /outro",
      "* /arquivo",
    ]);
  });

  it("skips a URL that is not a plain literal, not a URL, or a call that is not an HTTP verb", () => {
    const { requests } = linksOf(
      [
        "import requests",
        "",
        "def f(url):",
        "    requests.get(url)",
        '    requests.get(f"https://x.com/{url}")',
        '    requests.get(b"https://x.com/a")',
        '    requests.get("sem-url")',
        "    requests.get()",
        '    requests.Session("https://x.com/a")',
        '    requests.get.cache.clear("https://x.com/a")',
        '    requests.get(timeout=3, url="https://x.com/a")',
        '    other.get("https://x.com/a")',
        "",
      ].join("\n"),
    );

    expect(only(requests, "http")).toEqual([]);
  });

  it("accepts an f-string with no field and a keyword before the URL", () => {
    const { requests } = linksOf(
      [
        "import requests",
        "",
        "def f():",
        "    requests.get(timeout=3)",
        '    requests.get(f"https://x.com/fixa", timeout=3)',
        "",
      ].join("\n"),
    );

    expect(only(requests, "http").map((r) => r[1])).toEqual(["GET /fixa"]);
  });
});

describe("requests: process", () => {
  it("takes the file paths cited by subprocess and os.system calls", () => {
    const { requests } = linksOf(
      [
        "import os",
        "import subprocess",
        "",
        "def f():",
        '    subprocess.run(["node", "web/b.ts", "--fast"])',
        '    subprocess.call("python scripts/a.py --x 1")',
        '    subprocess.Popen(("bash", "./run.sh"))',
        '    subprocess.check_output(["node", "c.ts", "c.ts"])',
        '    os.system("node d.js")',
        "",
      ].join("\n"),
    );

    expect(only(requests, "process").map((r) => [r[1], r[3]])).toEqual([
      ["web/b.ts", 5],
      ["scripts/a.py", 6],
      ["./run.sh", 7],
      ["c.ts", 8],
      ["d.js", 9],
    ]);
  });

  it("skips a command with no file path, a variable and numbers", () => {
    const { requests } = linksOf(
      [
        "import os",
        "import subprocess",
        "",
        "def f(cmd):",
        '    subprocess.run(["ls", "-la"])',
        "    subprocess.run(cmd)",
        '    subprocess.run(["python3.11", "1.5"])',
        '    subprocess.run([cmd, "x" + "y.ts"])',
        "    os.system()",
        '    os.getcwd("a.ts")',
        "",
      ].join("\n"),
    );

    expect(only(requests, "process")).toEqual([]);
  });
});

describe("requests: name", () => {
  it("asks for a name that the file neither defines nor imports", () => {
    const { requests } = linksOf(
      [
        "import os",
        "from util import ajuda",
        "",
        "def local():",
        "    pass",
        "",
        "def f(callback):",
        "    local()",
        "    ajuda()",
        "    print(len([]))",
        "    callback()",
        "    notificar(1)",
        "    obj.metodo()",
        "    os.getcwd()",
        "",
      ].join("\n"),
    );

    expect(only(requests, "name")).toEqual([
      ["name", "notificar", "file:app.py/fn:f/s4", 12],
    ]);
  });

  it("puts a call that sits outside any function on the step of the module node", () => {
    const { requests } = linksOf("notificar(1)\n");

    expect(only(requests, "name")).toEqual([
      ["name", "notificar", "file:app.py/mod/s0", 1],
    ]);
  });

  it("skips a call whose function is not a name, such as a call of a call or an item", () => {
    const { requests } = linksOf("def f(x):\n    x[0]()\n    x()()\n");

    expect(requests).toEqual([]);
  });
});

describe("offers", () => {
  it("offers the own path of the file, on the file node", () => {
    const { offers } = linksOf("x = 1\n", "scripts/a.py");

    expect(only(offers, "process")).toEqual([
      ["process", "scripts/a.py", "file:scripts/a.py", 1],
    ]);
  });

  it("offers the top-level functions by name, not methods or nested functions", () => {
    const { offers } = linksOf(
      [
        "def um():",
        "    def interna():",
        "        pass",
        "",
        "class C:",
        "    def metodo(self):",
        "        pass",
        "",
        "@deco",
        "def dois():",
        "    pass",
        "",
      ].join("\n"),
    );

    expect(only(offers, "name")).toEqual([
      ["name", "um", "file:app.py/fn:um", 1],
      ["name", "dois", "file:app.py/fn:dois", 9],
    ]);
  });

  it("offers Flask and FastAPI routes on the function, at the decorator line", () => {
    const { offers } = linksOf(
      [
        "@app.get('/a')",
        "def a():",
        "    pass",
        "",
        "@router.post('/b/{id}')",
        "def b():",
        "    pass",
        "",
        "@app.route('/c')",
        "def c():",
        "    pass",
        "",
        "@app.route('/d', methods=['post', 'PUT'])",
        "def d():",
        "    pass",
        "",
        "@app.api_route('/e', methods=[], name='e')",
        "def e():",
        "    pass",
        "",
      ].join("\n"),
    );

    expect(only(offers, "http")).toEqual([
      ["http", "GET /a", "file:app.py/fn:a", 1],
      ["http", "POST /b/{id}", "file:app.py/fn:b", 5],
      ["http", "GET /c", "file:app.py/fn:c", 9],
      ["http", "POST /d", "file:app.py/fn:d", 13],
      ["http", "PUT /d", "file:app.py/fn:d", 13],
      ["http", "GET /e", "file:app.py/fn:e", 17],
    ]);
  });

  it("offers a route of a method on the method node", () => {
    const { offers } = linksOf(
      [
        "class C:",
        "    @app.get('/m')",
        "    def m(self):",
        "        pass",
        "",
      ].join("\n"),
    );

    expect(only(offers, "http")).toEqual([
      ["http", "GET /m", "file:app.py/cls:C/fn:m", 2],
    ]);
  });

  it("finds the route when a comment sits between the decorators", () => {
    const { offers } = linksOf(
      ["@cache", "# a rota", "@app.get('/a')", "def a():", "    pass", ""].join(
        "\n",
      ),
    );

    expect(only(offers, "http")).toEqual([
      ["http", "GET /a", "file:app.py/fn:a", 3],
    ]);
  });

  it("skips a route whose function has no node of its own", () => {
    const { offers } = linksOf(
      [
        "if True:",
        "    @app.get('/a')",
        "    def a():",
        "        pass",
        "",
      ].join("\n"),
    );

    expect(only(offers, "http")).toEqual([]);
  });

  it("skips decorators that are not routes", () => {
    const { offers } = linksOf(
      [
        "@cache",
        "@app.get",
        "@get('/a')",
        "@app.get('sem-barra')",
        "@app.get(rota)",
        "@app.errorhandler(404)",
        "@app.middleware('/x')",
        "@app.get('/ok')",
        "def a():",
        "    pass",
        "",
        "@app.get('/classe')",
        "class K:",
        "    pass",
        "",
      ].join("\n"),
    );

    expect(only(offers, "http")).toEqual([
      ["http", "GET /ok", "file:app.py/fn:a", 8],
    ]);
  });
});

describe("links of a whole fixture", () => {
  it("reads a file with routes, a request and a process", () => {
    const source = readFileSync(
      new URL("./fixtures/rotas.py", import.meta.url),
      "utf8",
    );
    const { offers, requests } = linksOf(source, "api/rotas.py");

    expect(offers.map((o) => [o[0], o[1]])).toEqual([
      ["process", "api/rotas.py"],
      ["http", "GET /frete"],
      ["http", "GET /itens/<id>"],
      ["http", "DELETE /itens/<id>"],
      ["name", "frete"],
      ["name", "itens"],
    ]);
    expect(requests.map((r) => [r[0], r[1]])).toEqual([
      ["http", "POST /pedidos"],
      ["process", "scripts/gerar.ts"],
      ["name", "notificar"],
    ]);
  });
});
