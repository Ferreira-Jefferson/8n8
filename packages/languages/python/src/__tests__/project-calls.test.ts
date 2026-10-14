import { describe, expect, it } from "vitest";
import { type CallContext, resolveCall } from "../calls";
import { importAliases } from "../imports";
import { loadPythonParser } from "../parse";

const TARGET = "file:frete/calculo.py/fn:calcular_frete";

/** Hits only for the full name of `calcular_frete` imported from `frete`. */
function hit(fullName: string): string | null {
  return fullName === "frete.calcular_frete" ? TARGET : null;
}

/** Parses `source` and resolves the statement on 1-based `line`. */
async function resolveAt(
  source: string,
  line: number,
  options: Pick<CallContext, "resolveImport" | "projectNames">,
) {
  const parser = await loadPythonParser();
  const root = parser.parse(source)?.rootNode;
  if (!root) throw new Error("parse failed");
  const statement = root
    .descendantsOfType("expression_statement")
    .find((n) => n.startPosition.row === line - 1);
  if (!statement) throw new Error(`no statement on line ${line}`);
  return resolveCall(statement, {
    topLevel: new Map(),
    methods: new Map(),
    aliases: importAliases(root),
    ...options,
  });
}

describe("resolveCall: project calls through imports (PROJ-04)", () => {
  it("turns an imported name the resolver knows into a call labeled as written", async () => {
    const source = "from frete import calcular_frete\nx = calcular_frete(x)\n";

    expect(await resolveAt(source, 2, { resolveImport: hit })).toEqual({
      kind: "call",
      target: TARGET,
      label: "calcular_frete",
    });
  });

  it("keeps today's external result when the resolver misses", async () => {
    const source = "from frete import calcular_frete\nx = calcular_frete(x)\n";

    expect(await resolveAt(source, 2, { resolveImport: () => null })).toEqual({
      kind: "external",
      callee: "frete.calcular_frete",
      category: "EXTERNO",
    });
  });

  it("lets a resolved project call win over an earlier external call", async () => {
    const source = [
      "import requests",
      "from frete import calcular_frete",
      "t = requests.get(u) or calcular_frete(1)",
    ].join("\n");

    expect(await resolveAt(source, 3, { resolveImport: hit })).toEqual({
      kind: "call",
      target: TARGET,
      label: "calcular_frete",
    });
  });
});

describe("resolveCall: project names without an import (PROJ-09)", () => {
  const options = { projectNames: new Set(["calcular_frete"]) };

  it("makes an unimported project name an EXTERNO external", async () => {
    expect(await resolveAt("x = calcular_frete()\n", 1, options)).toEqual({
      kind: "external",
      callee: "calcular_frete",
      category: "EXTERNO",
    });
  });

  it("gives no call to a dotted project path whose module was never imported", async () => {
    // `frete.calcular_frete` would resolve, but the file has no `import frete`.
    const source = "x = frete.calcular_frete(x)\n";

    expect(
      await resolveAt(source, 1, { ...options, resolveImport: hit }),
    ).toBeNull();
  });

  it("still gives no step for a name outside the project", async () => {
    expect(await resolveAt("print(x)\n", 1, options)).toBeNull();
  });
});
