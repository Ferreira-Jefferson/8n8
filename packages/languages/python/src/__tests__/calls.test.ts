import { describe, expect, it } from "vitest";
import { boundNames } from "../bound";
import { type CallContext, resolveCall } from "../calls";
import { importAliases } from "../imports";
import { loadPythonParser } from "../parse";

const TOP_LEVEL = new Map([
  ["calcular_frete", "fn:calcular_frete"],
  ["Pedido", "cls:Pedido"],
]);

/** Parses `source` and resolves the statement on 1-based `line`. */
async function resolveAt(
  source: string,
  line: number,
  methods: Map<string, string> = new Map(),
) {
  const parser = await loadPythonParser();
  const root = parser.parse(source)?.rootNode;
  if (!root) throw new Error("parse failed");
  const statement = root
    .descendantsOfType(["expression_statement", "return_statement"])
    .find((n) => n.startPosition.row === line - 1);
  if (!statement) throw new Error(`no statement on line ${line}`);
  const ctx: CallContext = {
    topLevel: TOP_LEVEL,
    methods,
    aliases: importAliases(root),
    bound: boundNames(root),
  };
  return resolveCall(statement, ctx);
}

describe("resolveCall: calls inside the snippet", () => {
  it("resolves a top-level def name to a call with its id", async () => {
    expect(await resolveAt("total = calcular_frete(3, 4)\n", 1)).toEqual({
      kind: "call",
      target: "fn:calcular_frete",
    });
  });

  it("resolves a class name to a call", async () => {
    expect(await resolveAt("p = Pedido()\n", 1)).toEqual({
      kind: "call",
      target: "cls:Pedido",
    });
  });

  it("resolves self.method() to the method of the same class", async () => {
    const source = [
      "class Pedido:",
      "    def validar(self):",
      "        pass",
      "    def fechar(self):",
      "        self.validar()",
    ].join("\n");
    const methods = new Map([["validar", "cls:Pedido/fn:validar"]]);
    expect(await resolveAt(source, 5, methods)).toEqual({
      kind: "call",
      target: "cls:Pedido/fn:validar",
    });
  });
});

describe("resolveCall: external calls", () => {
  it("replaces an import alias before the table", async () => {
    const source = 'import requests as r\nr.get("https://x")\n';
    expect(await resolveAt(source, 2)).toEqual({
      kind: "external",
      callee: "requests.get",
      category: "HTTP",
    });
  });

  it("counts a call whose root is an imported name", async () => {
    const source = 'import boto3\ns3 = boto3.client("s3")\n';
    expect(await resolveAt(source, 2)).toEqual({
      kind: "external",
      callee: "boto3.client",
      category: "EXTERNO",
    });
  });

  it("counts open as ARQUIVO", async () => {
    expect(await resolveAt("f = open(p)\n", 1)).toEqual({
      kind: "external",
      callee: "open",
      category: "ARQUIVO",
    });
  });

  it("counts .execute on a local variable as BANCO", async () => {
    expect(await resolveAt("cur.execute(q)\n", 1)).toEqual({
      kind: "external",
      callee: "cur.execute",
      category: "BANCO",
    });
  });

  it("counts .commit on a local variable as BANCO", async () => {
    expect(await resolveAt("conn.commit()\n", 1)).toEqual({
      kind: "external",
      callee: "conn.commit",
      category: "BANCO",
    });
  });

  it("counts .execute on a chained receiver as BANCO", async () => {
    expect(await resolveAt("conn.cursor().execute(q)\n", 1)).toEqual({
      kind: "external",
      callee: "conn.cursor().execute",
      category: "BANCO",
    });
  });

  it("counts .commit on an indexed receiver as BANCO", async () => {
    expect(await resolveAt("c[0].commit()\n", 1)).toEqual({
      kind: "external",
      callee: "c[0].commit",
      category: "BANCO",
    });
  });
});

describe("resolveCall: names the snippet does not define (VID-13)", () => {
  it("makes len an EXTERNO external", async () => {
    expect(await resolveAt("n = len(x)\n", 1)).toEqual({
      kind: "external",
      callee: "len",
      category: "EXTERNO",
    });
  });

  it("makes print an EXTERNO external", async () => {
    expect(await resolveAt("print(x)\n", 1)).toEqual({
      kind: "external",
      callee: "print",
      category: "EXTERNO",
    });
  });

  it("makes validar_pedido an EXTERNO external", async () => {
    expect(await resolveAt("validar_pedido(p)\n", 1)).toEqual({
      kind: "external",
      callee: "validar_pedido",
      category: "EXTERNO",
    });
  });

  it("makes db.salvar a BANCO external by its receiver", async () => {
    expect(await resolveAt("db.salvar(p)\n", 1)).toEqual({
      kind: "external",
      callee: "db.salvar",
      category: "BANCO",
    });
  });

  it("makes enviar_email an EMAIL external by its name", async () => {
    expect(await resolveAt("enviar_email(x)\n", 1)).toEqual({
      kind: "external",
      callee: "enviar_email",
      category: "EMAIL",
    });
  });

  it("keeps the table for an imported name (CORE-12)", async () => {
    const source = "import db\ndb.salvar(p)\n";
    expect(await resolveAt(source, 2)).toEqual({
      kind: "external",
      callee: "db.salvar",
      category: "EXTERNO",
    });
  });
});

describe("resolveCall: calls that do not count", () => {
  it("ignores a method on a local variable", async () => {
    expect(await resolveAt("lista = []\nlista.append(x)\n", 2)).toBeNull();
  });

  it("ignores a method on a bound receiver, as r.json() after r = f()", async () => {
    expect(await resolveAt("r = f()\nr.json()\n", 2)).toBeNull();
  });

  it("ignores self.x() when the class has no method x", async () => {
    const source = "class A:\n    def f(self):\n        self.x()\n";
    expect(await resolveAt(source, 3)).toBeNull();
  });

  it("ignores a method outside the table on a chained receiver", async () => {
    expect(await resolveAt("foo().append(x)\n", 1)).toBeNull();
  });
});

describe("resolveCall: several calls in one statement", () => {
  it("lets the snippet call win over an earlier external call", async () => {
    const source =
      "import requests\nt = requests.get(u) or calcular_frete(1, 2)\n";
    expect(await resolveAt(source, 2)).toEqual({
      kind: "call",
      target: "fn:calcular_frete",
    });
  });

  it("keeps the first external call in code order", async () => {
    const source = "import requests\nd = open(p) or requests.get(u)\n";
    expect(await resolveAt(source, 2)).toEqual({
      kind: "external",
      callee: "open",
      category: "ARQUIVO",
    });
  });
});
