import { describe, expect, it } from "vitest";
import { importAliases } from "../imports";
import { loadPythonParser } from "../parse";

async function aliasesOf(source: string): Promise<Map<string, string>> {
  const parser = await loadPythonParser();
  const tree = parser.parse(source);
  if (!tree) throw new Error("parse failed");
  return importAliases(tree.rootNode);
}

describe("importAliases", () => {
  it("maps a plain import to itself", async () => {
    expect(await aliasesOf("import requests\n")).toEqual(
      new Map([["requests", "requests"]]),
    );
  });

  it("maps an import alias to the module name", async () => {
    expect(await aliasesOf("import requests as r\n")).toEqual(
      new Map([["r", "requests"]]),
    );
  });

  it("maps a from-import name to module.name", async () => {
    expect(await aliasesOf("from pathlib import Path\n")).toEqual(
      new Map([["Path", "pathlib.Path"]]),
    );
  });

  it("maps a from-import alias to module.name", async () => {
    expect(await aliasesOf("from smtplib import SMTP as S\n")).toEqual(
      new Map([["S", "smtplib.SMTP"]]),
    );
  });

  it("maps a dotted import to its root name", async () => {
    expect(await aliasesOf("import os.path\n")).toEqual(
      new Map([["os", "os"]]),
    );
  });

  it("includes imports made inside a function", async () => {
    const source = [
      "import requests",
      "",
      "def enviar():",
      "    import smtplib as mail",
      "    mail.SMTP()",
    ].join("\n");
    expect(await aliasesOf(source)).toEqual(
      new Map([
        ["requests", "requests"],
        ["mail", "smtplib"],
      ]),
    );
  });
});
